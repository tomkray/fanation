/**
 * Append-only JSONL journal of ledger events. Replaying it from line 1
 * rebuilds the city; a line that no longer replays halts the boot.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LedgerEvent } from '../../core/cityLedger.js';
import { CommentSourceName } from '../../shared/apiContract.js';

export interface JournalRecord {
  readonly seq: number;
  readonly atIso: string;
  readonly source: CommentSourceName | 'market' | 'payment' | 'wallet';
  readonly event: LedgerEvent;
  /** SHA-256 chain link over the previous link and this record's body (see ledgerChain). */
  readonly hash?: string;
}

export interface EventJournal {
  load(): JournalRecord[];
  append(record: JournalRecord): void;
}

const BIGINT_TAG = '$bigint';

function encode(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? { [BIGINT_TAG]: value.toString() } : value;
}

function decode(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).length === 1 &&
    BIGINT_TAG in value
  ) {
    const raw = (value as Record<string, unknown>)[BIGINT_TAG];
    if (typeof raw === 'string' && /^-?\d+$/.test(raw)) {
      return BigInt(raw);
    }
  }
  return value;
}

/** The exact bytes a record's hash covers: everything but the hash, in a fixed key order. */
export function serializeRecordBody(record: JournalRecord): string {
  return JSON.stringify({ seq: record.seq, atIso: record.atIso, source: record.source, event: record.event }, encode);
}

export class FileEventJournal implements EventJournal {
  constructor(private readonly filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  load(): JournalRecord[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    const lines = readFileSync(this.filePath, 'utf-8').split('\n');
    const records: JournalRecord[] = [];
    lines.forEach((line, idx) => {
      if (line.trim().length === 0) {
        return;
      }
      try {
        records.push(JSON.parse(line, decode) as JournalRecord);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Journal ${this.filePath} line ${idx + 1} is not valid JSON: ${reason}`);
      }
    });
    return records;
  }

  /** Synchronous on purpose: a record is durable before the caller answers. */
  append(record: JournalRecord): void {
    appendFileSync(this.filePath, `${JSON.stringify(record, encode)}\n`, 'utf-8');
  }
}

export class MemoryEventJournal implements EventJournal {
  readonly records: JournalRecord[] = [];

  load(): JournalRecord[] {
    return [...this.records];
  }

  append(record: JournalRecord): void {
    this.records.push(record);
  }
}
