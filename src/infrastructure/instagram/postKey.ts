/**
 * One name per Instagram post, whichever door a comment came through.
 *
 * Muse pastes carry the post URL, the Graph poller sees a numeric media id
 * plus its permalink, and the webhook only sends the numeric id. Keying every
 * comment by the post's own code (`ig_<shortcode>`) makes "one counted comment
 * per fan per post" hold across doors: the same comment read twice never
 * scores twice.
 */

import { createHash } from 'node:crypto';
import { logger } from '../../utils/logger.js';

const SHORTCODE_PATH = /^\/(?:[A-Za-z0-9._]{1,30}\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,64})\/?$/;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_CACHED = 5_000;

/** The post's code from any instagram.com post or reel URL, or null. */
export function instagramShortcode(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) {
    return null;
  }
  return SHORTCODE_PATH.exec(parsed.pathname)?.[1] ?? null;
}

export function postMediaId(shortcode: string): string {
  return `ig_${shortcode}`;
}

/**
 * Ids the Muse bridge wrote before posts were keyed by their code: a hash of
 * the URL exactly as pasted. These are the forms Instagram's address bar gives.
 */
export function legacyMuseMediaIds(shortcode: string): string[] {
  const hosts = ['https://www.instagram.com', 'https://instagram.com'];
  const kinds = ['p', 'reel'];
  const urls: string[] = [];
  for (const host of hosts) {
    for (const kind of kinds) {
      urls.push(`${host}/${kind}/${shortcode}/`, `${host}/${kind}/${shortcode}`);
    }
  }
  return urls.map((url) => `muse_media_${createHash('sha256').update(url).digest('hex').slice(0, 32)}`);
}

export interface MediaKeyResolverOptions {
  readonly graphBaseUrl: string;
  readonly accessToken: string;
  readonly tokenTransport: 'query' | 'header';
  readonly fetchImpl?: typeof fetch;
}

/** Numeric media id → `ig_<shortcode>`, asked once per post and cached. Falls back to the id. */
export class MediaKeyResolver {
  private readonly cache = new Map<string, string>();
  private readonly fetchImpl: typeof fetch;
  private readonly graphOrigin: string;

  constructor(private readonly options: MediaKeyResolverOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.graphOrigin = new URL(options.graphBaseUrl).origin;
  }

  remember(mediaId: string, permalink: string | null): string {
    const code = permalink ? instagramShortcode(permalink) : null;
    if (!code) {
      return mediaId;
    }
    const key = postMediaId(code);
    if (this.cache.size >= MAX_CACHED) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(mediaId, key);
    return key;
  }

  async resolve(mediaId: string): Promise<string> {
    if (mediaId.startsWith('ig_')) {
      return mediaId;
    }
    const cached = this.cache.get(mediaId);
    if (cached) {
      return cached;
    }
    const url = new URL(`${this.options.graphBaseUrl}/${encodeURIComponent(mediaId)}`);
    url.searchParams.set('fields', 'permalink');
    if (url.origin !== this.graphOrigin) {
      return mediaId;
    }
    const headers = new Headers();
    if (this.options.tokenTransport === 'header') {
      headers.set('Authorization', `Bearer ${this.options.accessToken}`);
    } else {
      url.searchParams.set('access_token', this.options.accessToken);
    }
    try {
      const response = await this.fetchImpl(url.toString(), { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const body: unknown = await response.json().catch(() => null);
      const permalink =
        response.ok && typeof body === 'object' && body !== null && typeof (body as { permalink?: unknown }).permalink === 'string'
          ? (body as { permalink: string }).permalink
          : null;
      if (!permalink) {
        logger.warn('media_key_unresolved', { status: response.status });
        return mediaId;
      }
      return this.remember(mediaId, permalink);
    } catch (err) {
      // The numeric id still works inside one door; only cross-door matching is lost for this post.
      logger.warn('media_key_unresolved', { message: err instanceof Error ? err.message : String(err) });
      return mediaId;
    }
  }
}
