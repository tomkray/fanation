/**
 * Turns a Muse (or hand-copied) comment dump into ledger events.
 * Official Meta comment ids are kept. Missing ids become a stable hash of
 * media + author + text, so the same dump never mints twice.
 */

import { createHash } from 'node:crypto';
import { normalizeInstagramHandle } from '../../core/antiFraud.js';
import type { InstagramCommentEvent } from '../../core/types.js';
import { instagramShortcode, postMediaId } from './postKey.js';

const MAX_COMMENTS = 500;

export interface MuseCommentInput {
  readonly commentId?: string | null;
  readonly authorUsername: string;
  readonly text: string;
  readonly timestamp?: string | null;
}

export interface MuseBatchInput {
  readonly mediaUrl?: string | null;
  readonly mediaId?: string | null;
  readonly comments: readonly MuseCommentInput[];
}

export type MuseBridgeError = { readonly ok: false; readonly error: string };
export type MuseBridgeOk = { readonly ok: true; readonly events: readonly InstagramCommentEvent[]; readonly mediaId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Stable id when Muse (or a human paste) has no Meta comment id. */
export function museCommentId(mediaId: string, authorUsername: string, text: string): string {
  const digest = createHash('sha256').update(`${mediaId}\n${authorUsername}\n${text.trim()}`).digest('hex').slice(0, 40);
  return `muse_${digest}`;
}

/** The post's own code wins, so a Muse paste and the Graph API name the same post the same way. */
export function mediaIdFromBatch(batch: MuseBatchInput): string {
  const url = batch.mediaUrl?.trim();
  const code = url ? instagramShortcode(url) : null;
  if (code) {
    return postMediaId(code);
  }
  const explicit = batch.mediaId?.trim();
  if (explicit) {
    return explicit.slice(0, 64);
  }
  if (url) {
    return `muse_media_${createHash('sha256').update(url).digest('hex').slice(0, 32)}`;
  }
  return 'muse_media_unknown';
}

export function parseMuseBatch(body: unknown, nowMs: number = Date.now()): MuseBridgeOk | MuseBridgeError {
  if (!isRecord(body)) {
    return { ok: false, error: 'Body must be a JSON object.' };
  }
  const commentsRaw = body.comments;
  if (!Array.isArray(commentsRaw)) {
    return { ok: false, error: 'comments must be an array.' };
  }
  if (commentsRaw.length === 0) {
    return { ok: false, error: 'comments is empty.' };
  }
  if (commentsRaw.length > MAX_COMMENTS) {
    return { ok: false, error: `At most ${MAX_COMMENTS} comments per batch.` };
  }

  const batch: MuseBatchInput = {
    mediaUrl: readString(body, 'mediaUrl'),
    mediaId: readString(body, 'mediaId'),
    comments: [],
  };
  const mediaId = mediaIdFromBatch(batch);
  const events: InstagramCommentEvent[] = [];
  const seen = new Set<string>();

  for (const raw of commentsRaw) {
    if (!isRecord(raw)) {
      return { ok: false, error: 'Each comment must be an object.' };
    }
    const author = normalizeInstagramHandle(readString(raw, 'authorUsername') ?? '');
    const text = readString(raw, 'text');
    if (!author || !text) {
      return { ok: false, error: 'Each comment needs authorUsername and text.' };
    }
    const officialId = readString(raw, 'commentId');
    const commentId = officialId && !officialId.startsWith('muse_') ? officialId : museCommentId(mediaId, author, text);
    if (seen.has(commentId)) {
      continue;
    }
    seen.add(commentId);
    const stamp = readString(raw, 'timestamp');
    const receivedAtMs = stamp ? Date.parse(stamp) : nowMs;
    if (!Number.isFinite(receivedAtMs)) {
      return { ok: false, error: `Bad timestamp for @${author}.` };
    }
    events.push({
      commentId,
      mediaId,
      text,
      authorUsername: author,
      authorId: null,
      receivedAtMs,
    });
  }

  if (events.length === 0) {
    return { ok: false, error: 'No usable comments after filtering.' };
  }
  return { ok: true, events, mediaId };
}
