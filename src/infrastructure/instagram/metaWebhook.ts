/**
 * Meta webhook boundary: subscription handshake, `X-Hub-Signature-256`
 * verification over the raw bytes, and parsing of the `comments` field in
 * both body shapes Meta delivers (`entry[].changes[]` and flat `entry[]`).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { InstagramCommentEvent } from '../../core/types.js';
import { logger } from '../../utils/logger.js';

export function verifyHmacSha256Hex(secret: string, rawBody: Buffer, providedHex: string): boolean {
  if (!/^[a-fA-F0-9]{64}$/.test(providedHex)) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const provided = Buffer.from(providedHex, 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function verifyMetaSignature(appSecret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header || !header.startsWith('sha256=')) {
    logger.security('meta_webhook_signature_missing');
    return false;
  }
  const ok = verifyHmacSha256Hex(appSecret, rawBody, header.slice('sha256='.length).trim());
  if (!ok) {
    logger.security('meta_webhook_signature_mismatch');
  }
  return ok;
}

/** Returns the challenge to echo back, or null when the handshake is not ours. */
export function resolveSubscriptionChallenge(params: URLSearchParams, verifyToken: string): string | null {
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token') ?? '';
  const challenge = params.get('hub.challenge');
  if (mode !== 'subscribe' || challenge === null || !/^[A-Za-z0-9_-]{1,128}$/.test(challenge)) {
    return null;
  }
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  return a.length === b.length && timingSafeEqual(a, b) ? challenge : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toCommentEvent(value: unknown, entryTimeMs: number): InstagramCommentEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const from = isRecord(value.from) ? value.from : null;
  const media = isRecord(value.media) ? value.media : null;
  const commentId = str(value, 'id');
  const text = str(value, 'text');
  const username = from ? str(from, 'username') : null;
  const mediaId = media ? str(media, 'id') : null;
  if (!commentId || !text || !username || !mediaId) {
    return null;
  }
  // Replies (parent_id) do not mint or score; only top-level comments do.
  if (str(value, 'parent_id') !== null) {
    return null;
  }
  return {
    commentId,
    mediaId,
    text,
    authorUsername: username,
    authorId: from ? str(from, 'id') : null,
    receivedAtMs: entryTimeMs,
  };
}

export function parseMetaCommentWebhook(body: unknown, nowMs: number = Date.now()): InstagramCommentEvent[] {
  if (!isRecord(body) || body.object !== 'instagram' || !Array.isArray(body.entry)) {
    return [];
  }
  const events: InstagramCommentEvent[] = [];
  for (const entry of body.entry) {
    if (!isRecord(entry)) {
      continue;
    }
    const entryTimeMs = typeof entry.time === 'number' && entry.time > 0 ? entry.time * 1000 : nowMs;
    const changes: unknown[] = Array.isArray(entry.changes) ? entry.changes : [entry];
    for (const change of changes) {
      if (!isRecord(change) || change.field !== 'comments') {
        continue;
      }
      const event = toCommentEvent(change.value, entryTimeMs);
      if (event) {
        events.push(event);
      } else {
        logger.warn('meta_webhook_comment_skipped');
      }
    }
  }
  return events;
}
