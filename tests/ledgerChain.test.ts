/**
 * Tamper evidence (A6): every record is hash-chained, one Merkle root covers
 * the book, and a single record can be proven in it with a few hashes. An
 * edited, dropped or reordered line stops the replay before the reducer sees it.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_LEDGER_CONFIG } from '../src/core/cityLedger.js';
import { InstagramCommentEvent } from '../src/core/types.js';
import { CityService } from '../src/infrastructure/cityService.js';
import { JournalRecord, MemoryEventJournal } from '../src/infrastructure/persistence/eventJournal.js';
import { inclusionPath, leafHash, merkleRoot, verifyInclusion } from '../src/infrastructure/persistence/ledgerChain.js';

let n = 0;
function comment(author: string, text: string): InstagramCommentEvent {
  n += 1;
  return { commentId: `lc${n}`, mediaId: 'post_1', text, authorUsername: author, authorId: null, receivedAtMs: 1_760_000_000_000 + n * 61_000 };
}

function city(journal: MemoryEventJournal): CityService {
  return new CityService(DEFAULT_LEDGER_CONFIG, journal, (err) => {
    throw err;
  });
}

describe('Merkle proofs', () => {
  it('proves every leaf of every tree size, and nothing else', () => {
    for (let size = 1; size <= 33; size += 1) {
      const leaves = Array.from({ length: size }, (_, i) => leafHash(`record ${i}`));
      const root = merkleRoot(leaves);
      for (let i = 0; i < size; i += 1) {
        const path = inclusionPath(leaves, i);
        expect(verifyInclusion(leaves[i], i, size, path, root)).toBe(true);
        expect(verifyInclusion(leafHash('forged'), i, size, path, root)).toBe(false);
        if (size > 1) {
          expect(verifyInclusion(leaves[i], (i + 1) % size, size, path, root)).toBe(false);
        }
      }
    }
  });
});

describe('hash-chained journal', () => {
  it('stamps every new record, proves it, and replays to the same head', () => {
    const journal = new MemoryEventJournal();
    const live = city(journal);
    live.boot();
    live.ingestComments([comment('ana', '@taylorswift'), comment('ben', '@taylorswift')], 'instagram_webhook');
    const transfer = live.transferTokens('ana', 'ben', 25_000_000n);
    expect(journal.records.every((r) => /^[0-9a-f]{64}$/.test(r.hash ?? ''))).toBe(true);

    const head = live.ledgerHead();
    const replayed = city(journal);
    replayed.boot();
    expect(replayed.ledgerHead()).toEqual(head);

    const transferSeq = journal.records.find((r) => r.event.kind === 'token_transferred')?.seq ?? -1;
    const proof = live.ledgerProof(transferSeq, 'ben');
    expect(proof?.record).toContain(transfer.transferId);
    expect(
      verifyInclusion(
        Buffer.from(proof?.leafHash ?? '', 'hex'),
        proof?.index ?? -1,
        proof?.size ?? 0,
        (proof?.path ?? []).map((h) => Buffer.from(h, 'hex')),
        Buffer.from(head.merkleRoot, 'hex')
      )
    ).toBe(true);
    expect(leafHash(proof?.record ?? '').toString('hex')).toBe(proof?.leafHash);
    // Outsiders get the proof, not the bytes.
    expect(live.ledgerProof(transferSeq, 'mallory')?.record).toBeNull();
    expect(live.ledgerProof(transferSeq, null)?.record).toBeNull();
  });

  it('halts the replay when any record was edited, dropped or reordered', () => {
    const journal = new MemoryEventJournal();
    const live = city(journal);
    live.boot();
    live.ingestComments([comment('ana', '@taylorswift'), comment('ben', '@taylorswift')], 'instagram_webhook');
    live.transferTokens('ana', 'ben', 25_000_000n);
    const original = [...journal.records];

    const edit = (records: JournalRecord[]) => {
      const tampered = new MemoryEventJournal();
      tampered.records.push(...records);
      return () => city(tampered).boot();
    };

    const stolen = original.map((r) =>
      r.event.kind === 'token_transferred' ? { ...r, event: { ...r.event, transfer: { ...r.event.transfer, toHandle: 'mallory' } } } : r
    );
    expect(edit(stolen)).toThrow(/does not match its hash/);
    expect(edit([original[0], original[2]])).toThrow(/does not match its hash/);
    expect(edit([original[1], original[0], original[2]])).toThrow(/does not match its hash/);
    expect(edit(original)).not.toThrow();
  });

  it('covers records written before the chain existed', () => {
    const journal = new MemoryEventJournal();
    const live = city(journal);
    live.boot();
    live.ingestComments([comment('ana', '@taylorswift')], 'muse_bridge');
    live.ingestComments([comment('ben', '@taylorswift')], 'muse_bridge');
    // The first record loses its stored hash, as lines written before this release have none.
    const legacy = { ...journal.records[0] };
    delete (legacy as { hash?: string }).hash;
    const upgraded = new MemoryEventJournal();
    upgraded.records.push(legacy, journal.records[1]);
    expect(() => city(upgraded).boot()).not.toThrow();

    const editedLegacy = { ...legacy, event: { ...legacy.event } } as JournalRecord;
    if (editedLegacy.event.kind === 'comment') {
      (editedLegacy as { event: unknown }).event = { ...editedLegacy.event, event: { ...editedLegacy.event.event, authorUsername: 'mallory' } };
    }
    const forged = new MemoryEventJournal();
    forged.records.push(editedLegacy, journal.records[1]);
    expect(() => city(forged).boot()).toThrow(/does not match its hash/);
  });
});
