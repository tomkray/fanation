/**
 * Which Instagram account owns which profile (A10).
 *
 * An @ can be renamed and later taken by someone else; the account id Meta
 * reports cannot. The first login binds the profile to that id for good: the
 * same account keeps its profile after a rename, and a different account that
 * picks up an old @ is refused instead of inheriting its homes.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../../utils/logger.js';

const ACCOUNT_ID_PATTERN = /^[0-9A-Za-z_-]{1,64}$/;

export type IdentityResolution =
  | { readonly ok: true; readonly handle: string; readonly renamed: boolean }
  | { readonly ok: false; readonly reason: 'HANDLE_OWNED_BY_OTHER_ACCOUNT' | 'INVALID_ACCOUNT_ID' };

export class IdentityRegistry {
  private readonly handleByAccount = new Map<string, string>();
  private readonly accountByHandle = new Map<string, string>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  /** The profile this account may sign in to, binding it on the first login. */
  resolve(accountId: string, currentHandle: string): IdentityResolution {
    if (!ACCOUNT_ID_PATTERN.test(accountId)) {
      return { ok: false, reason: 'INVALID_ACCOUNT_ID' };
    }
    const bound = this.handleByAccount.get(accountId);
    if (bound) {
      if (bound !== currentHandle) {
        logger.info('identity_account_renamed', { profile: bound, now: currentHandle });
      }
      return { ok: true, handle: bound, renamed: bound !== currentHandle };
    }
    const owner = this.accountByHandle.get(currentHandle);
    if (owner && owner !== accountId) {
      logger.security('identity_handle_recycled', { handle: currentHandle });
      return { ok: false, reason: 'HANDLE_OWNED_BY_OTHER_ACCOUNT' };
    }
    this.handleByAccount.set(accountId, currentHandle);
    this.accountByHandle.set(currentHandle, accountId);
    this.save();
    return { ok: true, handle: currentHandle, renamed: false };
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      const entries = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? Object.entries(raw) : [];
      for (const [accountId, handle] of entries) {
        if (ACCOUNT_ID_PATTERN.test(accountId) && typeof handle === 'string') {
          this.handleByAccount.set(accountId, handle);
          this.accountByHandle.set(handle, accountId);
        }
      }
    } catch (err) {
      // Refuse to guess: an unreadable book would let a recycled @ through.
      throw new Error(`Identity file ${this.filePath} is unreadable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(`${this.filePath}.tmp`, JSON.stringify(Object.fromEntries(this.handleByAccount)), { mode: 0o600 });
    renameSync(`${this.filePath}.tmp`, this.filePath);
  }
}
