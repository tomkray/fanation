/**
 * "Connect": proving you are an Instagram @ without passwords (Axiom A10).
 *
 * Instagram Login only covers business/creator accounts, so every fan proves
 * their handle the way they already use Fanation: the site shows a one-time
 * code, they comment it on any @fanation.club post, and the comment arrives
 * through Meta (signed webhook or the Graph API) with Meta's own author
 * username. A code only verifies the @ it was issued for, once, within 15
 * minutes. The browser that asked for it then receives a session.
 *
 * Only SHA-256 digests of secrets are kept; sessions survive restarts.
 */

import { createHash, randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeInstagramHandle } from '../../core/antiFraud.js';
import { InstagramCommentEvent } from '../../core/types.js';
import { logger } from '../../utils/logger.js';

export const CHALLENGE_TTL_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 86_400_000;
/** No 0/O, 1/I/L: the code is typed on a phone. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
const CODE_PATTERN = /FAN-([2-9A-HJ-NP-Z]{6})/gi;
const MAX_PENDING_CHALLENGES = 2_000;
const MAX_PENDING_PER_HANDLE = 3;
const CHALLENGES_PER_CLIENT = 8;
const CLIENT_WINDOW_MS = 10 * 60_000;
const MAX_SESSIONS_PER_HANDLE = 10;

export type ChallengeState = 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'NONE';

interface Challenge {
  readonly handle: string;
  readonly code: string;
  readonly secretDigest: string;
  readonly expiresAtMs: number;
  verified: boolean;
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

function newCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return `FAN-${code}`;
}

export class AuthService {
  /** By secret digest (the browser's cookie) and by code (what arrives in comments). */
  private readonly challenges = new Map<string, Challenge>();
  private readonly challengeByCode = new Map<string, Challenge>();
  private readonly sessions = new Map<string, Session>();
  private readonly clientHits = new Map<string, number[]>();

  constructor(
    private readonly sessionsPath: string,
    private readonly now: () => number = Date.now
  ) {
    this.loadSessions();
  }

  createChallenge(rawHandle: string, clientKey: string): { readonly handle: string; readonly code: string; readonly secret: string; readonly expiresAtMs: number } {
    const handle = normalizeInstagramHandle(rawHandle);
    if (!handle) {
      throw new AuthLimitError('Enter a valid Instagram @handle.');
    }
    const nowMs = this.now();
    this.prune(nowMs);
    const hits = (this.clientHits.get(clientKey) ?? []).filter((t) => nowMs - t < CLIENT_WINDOW_MS);
    if (hits.length >= CHALLENGES_PER_CLIENT) {
      throw new AuthLimitError('Too many codes requested; wait a few minutes.');
    }
    hits.push(nowMs);
    this.clientHits.set(clientKey, hits);
    if (this.challenges.size >= MAX_PENDING_CHALLENGES) {
      throw new AuthLimitError('Verification is busy; try again in a minute.');
    }
    const forHandle = [...this.challenges.values()].filter((c) => c.handle === handle && !c.verified);
    if (forHandle.length >= MAX_PENDING_PER_HANDLE) {
      this.drop(forHandle[0]);
    }

    let code = newCode();
    while (this.challengeByCode.has(code)) {
      code = newCode();
    }
    const secret = randomBytes(32).toString('base64url');
    const challenge: Challenge = { handle, code, secretDigest: digest(secret), expiresAtMs: nowMs + CHALLENGE_TTL_MS, verified: false };
    this.challenges.set(challenge.secretDigest, challenge);
    this.challengeByCode.set(code, challenge);
    return { handle, code, secret, expiresAtMs: challenge.expiresAtMs };
  }

  /** Called with every fresh comment from Meta: a code counts only when its own @ wrote it. */
  observeComments(events: readonly InstagramCommentEvent[]): void {
    const nowMs = this.now();
    for (const event of events) {
      const author = normalizeInstagramHandle(event.authorUsername);
      if (!author) {
        continue;
      }
      for (const match of event.text.matchAll(CODE_PATTERN)) {
        const challenge = this.challengeByCode.get(`FAN-${match[1].toUpperCase()}`);
        if (challenge && !challenge.verified && challenge.handle === author && nowMs < challenge.expiresAtMs) {
          challenge.verified = true;
          logger.info('auth_handle_verified', { handle: author });
        }
      }
    }
  }

  /** The code a browser is waiting on, for the demo "simulate my comment" helper. */
  pendingFor(secret: string): { readonly handle: string; readonly code: string } | null {
    const challenge = this.challenges.get(digest(secret));
    return challenge && !challenge.verified && this.now() < challenge.expiresAtMs ? { handle: challenge.handle, code: challenge.code } : null;
  }

  /** Polled by the browser; on success the challenge is consumed and a session token is minted once. */
  poll(secret: string): { readonly state: ChallengeState; readonly handle: string | null; readonly sessionToken: string | null } {
    const challenge = this.challenges.get(digest(secret));
    if (!challenge) {
      return { state: 'NONE', handle: null, sessionToken: null };
    }
    if (challenge.verified) {
      this.drop(challenge);
      return { state: 'VERIFIED', handle: challenge.handle, sessionToken: this.openSession(challenge.handle) };
    }
    if (this.now() >= challenge.expiresAtMs) {
      this.drop(challenge);
      return { state: 'EXPIRED', handle: challenge.handle, sessionToken: null };
    }
    return { state: 'PENDING', handle: challenge.handle, sessionToken: null };
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

  private drop(challenge: Challenge): void {
    this.challenges.delete(challenge.secretDigest);
    this.challengeByCode.delete(challenge.code);
  }

  private prune(nowMs: number): void {
    for (const challenge of [...this.challenges.values()]) {
      // Verified challenges wait for their browser a little longer than the code's own lifetime.
      if (nowMs >= challenge.expiresAtMs + (challenge.verified ? CHALLENGE_TTL_MS : 0)) {
        this.drop(challenge);
      }
    }
    for (const [key, hits] of this.clientHits) {
      if (hits.every((t) => nowMs - t >= CLIENT_WINDOW_MS)) {
        this.clientHits.delete(key);
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
