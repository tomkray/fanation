/**
 * Signing in (Axiom A10): only the Instagram account itself can open a session.
 *
 * Instagram Login (OAuth) only covers professional accounts, so a fan proves
 * their @ through Direct: they message the official account, Meta delivers
 * that message signed and with the sender's account id, and we answer in the
 * same inbox with a one-time link. Only whoever reads that inbox can use it.
 * Typed names, comments and Muse dumps never open a session.
 *
 * Links: 256 bits, 10 minutes, single use. Sessions: 30 days, survive
 * restarts. Only SHA-256 digests of either are ever kept.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../../utils/logger.js';

export const LOGIN_LINK_TTL_MS = 10 * 60_000;
export const SESSION_TTL_MS = 30 * 86_400_000;
/** 32 random bytes in base64url. */
export const LOGIN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_PENDING_LINKS = 2_000;
const MAX_LINKS_PER_HANDLE = 3;
const MAX_SESSIONS_PER_HANDLE = 10;

interface LoginLink {
  readonly handle: string;
  readonly accountId: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

interface Session {
  readonly handle: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export class AuthLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthLimitError';
  }
}

function digest(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export class AuthService {
  /** By link-token digest. */
  private readonly links = new Map<string, LoginLink>();
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly sessionsPath: string,
    private readonly now: () => number = Date.now
  ) {
    this.loadSessions();
  }

  /** Issued only after Meta proved who sent the Direct message. Returns the raw token, once. */
  createLoginLink(handle: string, accountId: string): string {
    const nowMs = this.now();
    this.prune(nowMs);
    if (this.links.size >= MAX_PENDING_LINKS) {
      throw new AuthLimitError('Login is busy; try again in a minute.');
    }
    const mine = [...this.links.entries()].filter(([, l]) => l.handle === handle).sort((a, b) => a[1].createdAtMs - b[1].createdAtMs);
    while (mine.length >= MAX_LINKS_PER_HANDLE) {
      const oldest = mine.shift();
      if (oldest) {
        this.links.delete(oldest[0]);
      }
    }
    const token = randomBytes(32).toString('base64url');
    this.links.set(digest(token), { handle, accountId, createdAtMs: nowMs, expiresAtMs: nowMs + LOGIN_LINK_TTL_MS });
    return token;
  }

  /** Which @ a link would sign in as, without using it (the browser asks "is this you?"). */
  peekLoginLink(token: string): string | null {
    return this.liveLink(token)?.handle ?? null;
  }

  /** Uses the link exactly once and opens a session for its @. */
  redeemLoginLink(token: string): { readonly handle: string; readonly sessionToken: string } | null {
    const link = this.liveLink(token);
    if (!link) {
      return null;
    }
    this.links.delete(digest(token));
    logger.info('auth_link_redeemed', { handle: link.handle });
    return { handle: link.handle, sessionToken: this.openSession(link.handle) };
  }

  sessionHandle(token: string | undefined): string | null {
    if (!token) {
      return null;
    }
    const session = this.sessions.get(digest(token));
    if (!session) {
      return null;
    }
    if (this.now() >= session.expiresAtMs) {
      this.sessions.delete(digest(token));
      this.saveSessions();
      return null;
    }
    return session.handle;
  }

  revoke(token: string | undefined): void {
    if (token && this.sessions.delete(digest(token))) {
      this.saveSessions();
    }
  }

  private liveLink(token: string): LoginLink | null {
    if (!LOGIN_TOKEN_PATTERN.test(token)) {
      return null;
    }
    const link = this.links.get(digest(token));
    if (!link) {
      return null;
    }
    if (this.now() >= link.expiresAtMs) {
      this.links.delete(digest(token));
      return null;
    }
    return link;
  }

  private openSession(handle: string): string {
    const nowMs = this.now();
    const mine = [...this.sessions.entries()].filter(([, s]) => s.handle === handle).sort((a, b) => a[1].createdAtMs - b[1].createdAtMs);
    while (mine.length >= MAX_SESSIONS_PER_HANDLE) {
      const oldest = mine.shift();
      if (oldest) {
        this.sessions.delete(oldest[0]);
      }
    }
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(digest(token), { handle, createdAtMs: nowMs, expiresAtMs: nowMs + SESSION_TTL_MS });
    this.saveSessions();
    return token;
  }

  private prune(nowMs: number): void {
    for (const [key, link] of this.links) {
      if (nowMs >= link.expiresAtMs) {
        this.links.delete(key);
      }
    }
  }

  private loadSessions(): void {
    if (!existsSync(this.sessionsPath)) {
      return;
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.sessionsPath, 'utf-8'));
      const entries = typeof raw === 'object' && raw !== null ? Object.entries(raw as Record<string, Session>) : [];
      const nowMs = this.now();
      for (const [key, session] of entries) {
        if (typeof session?.handle === 'string' && typeof session.expiresAtMs === 'number' && session.expiresAtMs > nowMs) {
          this.sessions.set(key, session);
        }
      }
    } catch (err) {
      // Losing sessions only means signing in again; never block the boot on it.
      logger.error('sessions_file_unreadable', { message: err instanceof Error ? err.message : String(err) });
    }
  }

  private saveSessions(): void {
    mkdirSync(path.dirname(this.sessionsPath), { recursive: true });
    writeFileSync(`${this.sessionsPath}.tmp`, JSON.stringify(Object.fromEntries(this.sessions)), { mode: 0o600 });
    renameSync(`${this.sessionsPath}.tmp`, this.sessionsPath);
  }
}
