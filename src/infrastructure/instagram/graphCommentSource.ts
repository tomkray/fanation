/**
 * Reads comments on the official account's recent posts through the
 * Instagram Graph API. Only posts whose `comments_count` changed since the
 * previous tick are re-read; overlap is harmless because the ledger dedupes
 * by comment id.
 */

import { InstagramCommentEvent } from '../../core/types.js';
import { logger } from '../../utils/logger.js';
import { CommentSource } from './commentSource.js';

const COMMENT_FIELDS = 'id,text,timestamp,username';
const COMMENTS_PAGE_SIZE = 50;
const MAX_COMMENT_PAGES_PER_POST = 20;
const REQUEST_TIMEOUT_MS = 15_000;

export interface GraphCommentSourceOptions {
  readonly graphBaseUrl: string;
  readonly igUserId: string;
  readonly accessToken: string;
  readonly mediaLimit: number;
  /** `query` is Meta's documented form; `header` keeps the token out of URLs. */
  readonly tokenTransport?: 'query' | 'header';
  readonly fetchImpl?: typeof fetch;
}

export class GraphApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'GraphApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

interface GraphPage {
  readonly data: readonly Record<string, unknown>[];
  readonly next: string | null;
}

interface ListedMedia {
  readonly id: string;
  readonly timestampMs: number;
  readonly commentsCount: number | null;
}

export class GraphCommentSource implements CommentSource {
  readonly name = 'instagram_poll' as const;
  private readonly lastCommentsCountByMedia = new Map<string, number>();
  /** Posts already read on a token that does not report comments_count. */
  private readonly seenWithoutCount = new Set<string>();
  private readonly fetchImpl: typeof fetch;
  private readonly allowedOrigin: string;

  constructor(private readonly options: GraphCommentSourceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.allowedOrigin = new URL(options.graphBaseUrl).origin;
  }

  async fetchComments(): Promise<InstagramCommentEvent[]> {
    const listed = await this.listMedia();
    let newestId: string | null = null;
    let newestAt = Number.NEGATIVE_INFINITY;
    for (const media of listed.media) {
      if (media.timestampMs >= newestAt) {
        newestAt = media.timestampMs;
        newestId = media.id;
      }
    }

    const events: InstagramCommentEvent[] = [];
    for (const media of listed.media) {
      if (!this.shouldRead(media, listed.countsAvailable, media.id === newestId)) {
        continue;
      }
      events.push(...(await this.fetchMediaComments(media.id)));
      if (media.commentsCount !== null) {
        this.lastCommentsCountByMedia.set(media.id, media.commentsCount);
      } else {
        this.seenWithoutCount.add(media.id);
      }
    }
    return events;
  }

  /**
   * `comments_count` is the cheap "did this post change?" signal. Some tokens
   * reject that field; the newest post is then re-read every tick, and each
   * older post is read once. Comment ids already in the journal are ignored.
   */
  private async listMedia(): Promise<{ readonly countsAvailable: boolean; readonly media: readonly ListedMedia[] }> {
    try {
      const page = await this.getPage(this.mediaListUrl(true));
      return { countsAvailable: true, media: this.readMedia(page, true) };
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (!(err instanceof GraphApiError) || !/comments_count/i.test(message)) {
        throw err;
      }
      logger.warn('graph_comments_count_unavailable', { message });
      const page = await this.getPage(this.mediaListUrl(false));
      return { countsAvailable: false, media: this.readMedia(page, false) };
    }
  }

  private mediaListUrl(withCount: boolean): string {
    const mediaUrl = new URL(`${this.options.graphBaseUrl}/${encodeURIComponent(this.options.igUserId)}/media`);
    mediaUrl.searchParams.set('fields', withCount ? 'id,timestamp,comments_count' : 'id,timestamp');
    mediaUrl.searchParams.set('limit', String(this.options.mediaLimit));
    return mediaUrl.toString();
  }

  private readMedia(page: GraphPage, withCount: boolean): ListedMedia[] {
    const media: ListedMedia[] = [];
    for (const raw of page.data) {
      const id = readString(raw, 'id');
      if (!id) {
        logger.warn('graph_media_skipped_malformed');
        continue;
      }
      const timestamp = readString(raw, 'timestamp');
      const timestampMs = timestamp ? Date.parse(timestamp) : Number.NaN;
      const commentsCount = withCount && typeof raw.comments_count === 'number' ? raw.comments_count : null;
      media.push({ id, timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0, commentsCount });
    }
    return media;
  }

  private shouldRead(media: ListedMedia, countsAvailable: boolean, isNewest: boolean): boolean {
    if (countsAvailable && media.commentsCount !== null) {
      return this.lastCommentsCountByMedia.get(media.id) !== media.commentsCount;
    }
    // The launch reel is the newest post. Keep reading it until a count exists.
    if (isNewest) {
      return true;
    }
    return !this.seenWithoutCount.has(media.id);
  }

  private async fetchMediaComments(mediaId: string): Promise<InstagramCommentEvent[]> {
    const firstUrl = new URL(`${this.options.graphBaseUrl}/${encodeURIComponent(mediaId)}/comments`);
    firstUrl.searchParams.set('fields', COMMENT_FIELDS);
    firstUrl.searchParams.set('limit', String(COMMENTS_PAGE_SIZE));

    const events: InstagramCommentEvent[] = [];
    let nextUrl: string | null = firstUrl.toString();
    for (let page = 0; nextUrl !== null && page < MAX_COMMENT_PAGES_PER_POST; page += 1) {
      const result: GraphPage = await this.getPage(nextUrl);
      for (const raw of result.data) {
        const event = this.toEvent(raw, mediaId);
        if (event) {
          events.push(event);
        }
      }
      nextUrl = result.next;
    }
    if (nextUrl !== null) {
      logger.warn('graph_comments_page_cap_reached', { mediaId, cap: MAX_COMMENT_PAGES_PER_POST });
    }
    return events;
  }

  private toEvent(raw: Record<string, unknown>, mediaId: string): InstagramCommentEvent | null {
    const commentId = readString(raw, 'id');
    const text = readString(raw, 'text');
    const from = isRecord(raw.from) ? raw.from : null;
    const user = isRecord(raw.user) ? raw.user : null;
    const username = readString(raw, 'username') ?? (from ? readString(from, 'username') : null) ?? (user ? readString(user, 'username') : null);
    const timestamp = readString(raw, 'timestamp');
    const receivedAtMs = timestamp ? Date.parse(timestamp) : Number.NaN;
    if (!commentId || !text || !username || !Number.isFinite(receivedAtMs)) {
      logger.warn('graph_comment_skipped_malformed', { mediaId });
      return null;
    }
    return {
      commentId,
      mediaId,
      text,
      authorUsername: username,
      authorId: from ? readString(from, 'id') : null,
      receivedAtMs,
    };
  }

  /** URLs carrying the token are never logged; only the Graph origin is ever contacted. */
  private async getPage(url: string): Promise<GraphPage> {
    const target = new URL(url);
    if (target.origin !== this.allowedOrigin) {
      throw new GraphApiError(0, `Refusing to follow paging URL outside ${this.allowedOrigin}.`);
    }
    const viaHeader = this.options.tokenTransport === 'header';
    if (!viaHeader && !target.searchParams.has('access_token')) {
      target.searchParams.set('access_token', this.options.accessToken);
    }
    const response = await this.fetchImpl(target.toString(), {
      headers: viaHeader ? { Authorization: `Bearer ${this.options.accessToken}` } : {},
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(body)) {
      const error = isRecord(body) && isRecord(body.error) ? readString(body.error, 'message') : null;
      throw new GraphApiError(response.status, error ?? `Graph API HTTP ${response.status}`);
    }
    const data = Array.isArray(body.data) ? body.data.filter(isRecord) : [];
    const paging = isRecord(body.paging) ? body.paging : null;
    return { data, next: paging ? readString(paging, 'next') : null };
  }
}
