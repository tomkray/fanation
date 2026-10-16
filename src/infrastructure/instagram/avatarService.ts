/**
 * Real Instagram profile pictures and names for the people at the top of the
 * ranking, through the official Business Discovery API (professional
 * accounts only — personal accounts are not exposed by any official API, so
 * those keep the generated avatar).
 *
 * Instagram picture URLs are signed and expire, so images are downloaded once,
 * stored on our disk and served from our own origin.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../../utils/logger.js';

const HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/;
const ALLOWED_IMAGE_HOSTS = [/(^|\.)cdninstagram\.com$/i, /(^|\.)fbcdn\.net$/i];
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;
const REFRESH_AFTER_MS = 24 * 3_600_000;
/** Accounts the API cannot look up (personal, private, renamed) are retried weekly. */
const UNAVAILABLE_RETRY_MS = 7 * 24 * 3_600_000;
const WARM_DELAY_MS = 1_500;
/** One lookup at a time. At this pace a busy launch still finishes in hours, not a burst. */
const MAX_LOOKUPS_PER_HOUR = 400;
const MAX_QUEUE = 2_000;

interface AvatarMeta {
  readonly handle: string;
  readonly fetchedAtMs: number;
  readonly available: boolean;
  readonly contentType?: string;
  readonly name?: string;
  readonly followersCount?: number;
}

export interface AvatarServiceOptions {
  readonly directory: string;
  /** Business Discovery lives on the Facebook-login Graph API. */
  readonly graphBaseUrl: string;
  readonly igUserId: string | null;
  readonly accessToken: string | null;
  readonly fetchImpl?: typeof fetch;
  readonly nowMs?: () => number;
  /** Test seam. Production uses the hourly cap above. */
  readonly maxLookupsPerHour?: number;
  readonly warmDelayMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAllowedImageUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.some((pattern) => pattern.test(url.hostname));
  } catch {
    return false;
  }
}

export class AvatarService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly maxLookupsPerHour: number;
  private readonly warmDelayMs: number;
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private readonly lookupsAtMs: number[] = [];
  private pumping = false;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: AvatarServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.nowMs ?? Date.now;
    this.maxLookupsPerHour = options.maxLookupsPerHour ?? MAX_LOOKUPS_PER_HOUR;
    this.warmDelayMs = options.warmDelayMs ?? WARM_DELAY_MS;
    mkdirSync(options.directory, { recursive: true });
  }

  /** Can new pictures be fetched? Cached ones are served either way. */
  get enabled(): boolean {
    return Boolean(this.options.accessToken && this.options.igUserId);
  }

  read(handle: string): { readonly bytes: Buffer; readonly contentType: string } | null {
    if (!HANDLE_PATTERN.test(handle)) {
      return null;
    }
    const meta = this.readMeta(handle);
    const imagePath = path.join(this.options.directory, `${handle}.img`);
    if (!meta?.available || !meta.contentType || !existsSync(imagePath)) {
      return null;
    }
    return { bytes: readFileSync(imagePath), contentType: meta.contentType };
  }

  /** The account's real name as Instagram reports it, when we have looked it up. */
  verifiedName(handle: string): string | null {
    const meta = HANDLE_PATTERN.test(handle) ? this.readMeta(handle) : null;
    return meta?.available && meta.name ? meta.name : null;
  }

  /**
   * Ask for pictures of @s the city already knows. Missing and stale ones wait
   * in one queue. The public route must not call this with a stranger's name:
   * that would turn the endpoint into an open scraper.
   */
  enqueue(handles: readonly string[]): void {
    if (!this.enabled) {
      return;
    }
    for (const handle of handles) {
      if (!HANDLE_PATTERN.test(handle) || this.queued.has(handle) || !this.isStale(handle)) {
        continue;
      }
      if (this.queue.length >= MAX_QUEUE) {
        break;
      }
      this.queue.push(handle);
      this.queued.add(handle);
    }
    this.pump();
  }

  /** @deprecated Callers enqueue. Kept so a warm pass is just a priority enqueue. */
  async warm(handles: readonly string[]): Promise<void> {
    this.enqueue(handles);
  }

  async refresh(handle: string): Promise<boolean> {
    if (!this.enabled || !HANDLE_PATTERN.test(handle)) {
      return false;
    }
    try {
      const profile = await this.lookup(handle);
      if (!profile) {
        this.writeMeta({ handle, fetchedAtMs: this.now(), available: false });
        return false;
      }
      const image = await this.download(profile.pictureUrl);
      const imagePath = path.join(this.options.directory, `${handle}.img`);
      writeFileSync(`${imagePath}.tmp`, image.bytes);
      renameSync(`${imagePath}.tmp`, imagePath);
      this.writeMeta({
        handle,
        fetchedAtMs: this.now(),
        available: true,
        contentType: image.contentType,
        name: profile.name,
        followersCount: profile.followersCount,
      });
      logger.info('avatar_refreshed', { handle, bytes: image.bytes.length });
      return true;
    } catch (err) {
      logger.warn('avatar_refresh_failed', { handle, message: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  private pump(): void {
    if (this.pumping || !this.enabled) {
      return;
    }
    this.pumping = true;
    void this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        if (!this.takeBudget()) {
          this.resumeTimer = setTimeout(() => {
            this.resumeTimer = null;
            this.pumping = false;
            this.pump();
          }, 60_000);
          this.resumeTimer.unref?.();
          return;
        }
        const handle = this.queue.shift();
        if (!handle) {
          break;
        }
        this.queued.delete(handle);
        await this.refresh(handle);
        if (this.warmDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.warmDelayMs));
        }
      }
    } finally {
      if (this.resumeTimer === null) {
        this.pumping = false;
      }
    }
  }

  private takeBudget(): boolean {
    const now = this.now();
    while (this.lookupsAtMs.length > 0 && now - this.lookupsAtMs[0] >= 3_600_000) {
      this.lookupsAtMs.shift();
    }
    if (this.lookupsAtMs.length >= this.maxLookupsPerHour) {
      return false;
    }
    this.lookupsAtMs.push(now);
    return true;
  }

  private isStale(handle: string): boolean {
    const meta = this.readMeta(handle);
    if (!meta) {
      return true;
    }
    const age = this.now() - meta.fetchedAtMs;
    return age > (meta.available ? REFRESH_AFTER_MS : UNAVAILABLE_RETRY_MS);
  }

  private async lookup(handle: string): Promise<{ pictureUrl: string; name?: string; followersCount?: number } | null> {
    const url = new URL(`${this.options.graphBaseUrl}/${encodeURIComponent(this.options.igUserId ?? '')}`);
    // `handle` matched HANDLE_PATTERN, so it cannot break out of the field expression.
    url.searchParams.set('fields', `business_discovery.username(${handle}){username,name,profile_picture_url,followers_count}`);
    url.searchParams.set('access_token', this.options.accessToken ?? '');
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(body) || !isRecord(body.business_discovery)) {
      return null;
    }
    const profile = body.business_discovery;
    const pictureUrl = typeof profile.profile_picture_url === 'string' ? profile.profile_picture_url : null;
    if (!pictureUrl || !isAllowedImageUrl(pictureUrl)) {
      return null;
    }
    return {
      pictureUrl,
      name: typeof profile.name === 'string' ? profile.name.slice(0, 60) : undefined,
      followersCount: typeof profile.followers_count === 'number' ? profile.followers_count : undefined,
    };
  }

  /** Follows redirects by hand so every hop stays on Instagram's image CDN. */
  private async download(startUrl: string): Promise<{ bytes: Buffer; contentType: string }> {
    let current = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isAllowedImageUrl(current)) {
        throw new Error('Image URL left the allowed CDN.');
      }
      const response = await this.fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error('Redirect without location.');
        }
        current = new URL(location, current).toString();
        continue;
      }
      if (!response.ok) {
        throw new Error(`Image HTTP ${response.status}.`);
      }
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
        throw new Error(`Unexpected image type ${contentType || 'none'}.`);
      }
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > MAX_IMAGE_BYTES) {
        throw new Error('Image too large.');
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_IMAGE_BYTES || bytes.length === 0) {
        throw new Error('Image size out of bounds.');
      }
      return { bytes, contentType };
    }
    throw new Error('Too many redirects.');
  }

  private readMeta(handle: string): AvatarMeta | null {
    const metaPath = path.join(this.options.directory, `${handle}.json`);
    if (!existsSync(metaPath)) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(metaPath, 'utf-8'));
      return isRecord(parsed) && typeof parsed.fetchedAtMs === 'number' && typeof parsed.available === 'boolean'
        ? (parsed as unknown as AvatarMeta)
        : null;
    } catch {
      return null;
    }
  }

  private writeMeta(meta: AvatarMeta): void {
    const metaPath = path.join(this.options.directory, `${meta.handle}.json`);
    writeFileSync(`${metaPath}.tmp`, JSON.stringify(meta));
    renameSync(`${metaPath}.tmp`, metaPath);
  }
}
