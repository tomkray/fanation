/**
 * Comment validation rules (Axiom A2). Everything here is pure so the ledger
 * can replay a journal and reach the same decisions.
 */

import { isFeaturedFandom } from './fandomRegistry.js';
import { InstagramCommentEvent, ParsedCommentIntent } from './types.js';

export const MAX_COMMENT_LENGTH = 280;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_EVENTS_PER_HANDLE = 5;
/** Friends beyond this in one comment are ignored: a wall of @s is spam, not an invitation. */
export const MAX_FRIEND_TAGS_PER_COMMENT = 5;

const MENTION_REGEX = /(?:^|[^a-zA-Z0-9._@])@([a-zA-Z0-9._]{1,30})/g;
const CONTROL_OR_BIDI_REGEX =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/;
const SCRIPT_PAYLOAD_REGEX = /(<\s*script|javascript:|on\w+\s*=)/i;
const REPEATED_CHAR_SPAM_REGEX = /(.)\1{14,}/u;

export type CommentFormatError = {
  readonly error: string;
  readonly code: 'INVALID_COMMENT_FORMAT' | 'SELF_MINT_FORBIDDEN';
};

/** Lowercase, no leading `@`. Instagram handles never start/end with `.` or contain `..`. */
export function normalizeInstagramHandle(rawHandle: string): string | null {
  const trimmed = rawHandle.trim().replace(/^@/, '').toLowerCase();
  if (trimmed.length < 1 || trimmed.length > 30) {
    return null;
  }
  if (trimmed.startsWith('.') || trimmed.endsWith('.') || trimmed.includes('..')) {
    return null;
  }
  if (!/^[a-z0-9._]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * The fan is whoever Meta says wrote the comment; the comment only has to name
 * the idol: `@taylorswift`. The fan's own @ and the official account are
 * ignored if present. When a fan also tags friends, a catalogued fandom wins
 * over an unknown handle; otherwise the first mention is the idol.
 */
export function parseAndValidateComment(
  event: InstagramCommentEvent,
  officialAccountHandle: string | null = null
): ParsedCommentIntent | CommentFormatError {
  const rawText = event.text.trim();
  if (rawText.length === 0 || rawText.length > MAX_COMMENT_LENGTH) {
    return { code: 'INVALID_COMMENT_FORMAT', error: `Comment length out of bounds (1..${MAX_COMMENT_LENGTH}).` };
  }
  if (CONTROL_OR_BIDI_REGEX.test(rawText)) {
    return { code: 'INVALID_COMMENT_FORMAT', error: 'Comment contains control or bidi-override characters.' };
  }
  if (SCRIPT_PAYLOAD_REGEX.test(rawText) || REPEATED_CHAR_SPAM_REGEX.test(rawText)) {
    return { code: 'INVALID_COMMENT_FORMAT', error: 'Comment rejected by script/spam filter.' };
  }

  const fan = normalizeInstagramHandle(event.authorUsername);
  if (!fan) {
    return { code: 'INVALID_COMMENT_FORMAT', error: 'Invalid author username in webhook payload.' };
  }

  // A sentence-ending period is not part of a handle ("... @taylorswift.").
  const mentions = Array.from(rawText.matchAll(MENTION_REGEX), (m) => normalizeInstagramHandle(m[1].replace(/\.+$/, '')))
    .filter((handle): handle is string => handle !== null);
  if (mentions.length === 0) {
    return { code: 'INVALID_COMMENT_FORMAT', error: 'Mention the artist, club or creator you are a fan of, e.g. @taylorswift.' };
  }

  const candidates = [...new Set(mentions)].filter((h) => h !== fan && h !== officialAccountHandle);
  if (candidates.length === 0) {
    return mentions.includes(fan)
      ? { code: 'SELF_MINT_FORBIDDEN', error: 'A fan cannot be their own fandom.' }
      : { code: 'INVALID_COMMENT_FORMAT', error: 'Mention your idol, not only @naoeumfa.' };
  }

  const fandomHandle = candidates.find(isFeaturedFandom) ?? candidates[0];
  return {
    commentId: event.commentId,
    mediaId: event.mediaId,
    voterHandle: fan,
    fandomHandle,
    friendHandles: candidates.filter((h) => h !== fandomHandle).slice(0, MAX_FRIEND_TAGS_PER_COMMENT),
  };
}

/**
 * Sliding window per author. Mutates `timestamps` in place (pruned + appended)
 * and returns whether this event is within the limit.
 */
export function consumeHandleRateLimit(timestamps: number[], nowMs: number): boolean {
  const windowStart = nowMs - RATE_LIMIT_WINDOW_MS;
  let firstFresh = 0;
  while (firstFresh < timestamps.length && timestamps[firstFresh] <= windowStart) {
    firstFresh += 1;
  }
  timestamps.splice(0, firstFresh);
  if (timestamps.length >= RATE_LIMIT_MAX_EVENTS_PER_HANDLE) {
    return false;
  }
  timestamps.push(nowMs);
  return true;
}
