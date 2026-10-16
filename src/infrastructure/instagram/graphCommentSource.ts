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

export class GraphCommentSource implements CommentSource {
  readonly name = 'instagram_poll' as const;
  private readonly lastCommentsCountByMedia = new Map<string, number>();
  private readonly fetchImpl: typeof fetch;
  private readonly allowedOrigin: string;

  constructor(private readonly options: GraphCommentSourceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.allowedOrigin = new URL(options.graphBaseUrl).origin;
  }

  async fetchComments(): Promise<InstagramCommentEvent[]> {
    const mediaUrl = new URL(`${this.options.graphBaseUrl}/${encodeURIComponent(this.options.igUserId)}/media`);
    mediaUrl.searchParams.set('fields', 'id,timestamp,comments_count');
    mediaUrl.searchParams.set('limit', String(this.options.mediaLimit));
    const mediaPage = await this.getPage(mediaUrl.toString());

    const events: InstagramCommentEvent[] = [];
    for (const media of mediaPage.data) {
      const mediaId = readString(media, 'id');
      const count = typeof media.comments_count === 'number' ? media.comments_count : null;
      if (!mediaId || count === null) {
        logger.warn('graph_media_skipped_malformed');
        continue;
      }
      if (this.lastCommentsCountByMedia.get(mediaId) === count) {
        continue;
      }
      events.push(...(await this.fetchMediaComments(mediaId)));
      this.lastCommentsCountByMedia.set(mediaId, count);
    }
    return events;
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
    const username = readString(raw, 'username') ?? (from ? readString(from, 'username') : null);
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
