/**
 * Real Instagram profile pictures for handles the city already knows.
 *
 * One pipeline for every comment door (poller, webhook, Muse bridge):
 * enqueue → refresh → disk cache → GET /api/v1/avatars/:handle.
 *
 * Lookup order: Business Discovery when NAOEUMFA_DISCOVERY_* is set, otherwise
 * the public profile og:image (same CDN hosts). No second product path.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../../utils/logger.js';

const HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/;
const ALLOWED_IMAGE_HOSTS = [/(^|\.)cdninstagram\.com$/i, /(^|\.)fbcdn\.net$/i];
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;
const REFRESH_AFTER_MS = 24 * 3_600_000;
/** Accounts we cannot resolve are retried weekly. */
const UNAVAILABLE_RETRY_MS = 7 * 24 * 3_600_000;
const WARM_DELAY_MS = 1_500;
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

  /** Graph Business Discovery credentials are present (preferred lookup). */
  get discoveryEnabled(): boolean {
    return Boolean(this.options.accessToken && this.options.igUserId);
  }

  /**
   * Fetch pipeline is always on — same enqueue after every mint door.
   * Discovery when set; public-page interim otherwise.
   */
  get enabled(): boolean {
    return true;
  }

  /** True when at least one portrait is on disk. */
  hasAnyCached(): boolean {
    try {
      for (const name of readdirSync(this.options.directory)) {
        if (!name.endsWith('.json')) {
          continue;
        }
        const handle = name.slice(0, -'.json'.length);
        if (HANDLE_PATTERN.test(handle) && this.read(handle)) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Inject bytes into the same cache refresh would write (operator / agent
   * when lookup cannot reach the CDN). Not a second product path.
   */
  seed(handle: string, bytes: Buffer, contentType: string, name?: string): void {
    if (!HANDLE_PATTERN.test(handle)) {
      throw new Error(`Invalid handle: ${handle}`);
    }
    const type = contentType.split(';')[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(type)) {
      throw new Error(`Unexpected image type ${type || 'none'}.`);
    }
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      throw new Error('Image size out of bounds.');
    }
    const imagePath = path.join(this.options.directory, `${handle}.img`);
    writeFileSync(`${imagePath}.tmp`, bytes);
    renameSync(`${imagePath}.tmp`, imagePath);
    this.writeMeta({
      handle,
      fetchedAtMs: this.now(),
      available: true,
      contentType: type,
      name: name?.slice(0, 60),
    });
    logger.info('avatar_seeded', { handle, bytes: bytes.length, contentType: type });
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

  verifiedName(handle: string): string | null {
    const meta = HANDLE_PATTERN.test(handle) ? this.readMeta(handle) : null;
    return meta?.available && meta.name ? meta.name : null;
  }

  /**
   * Queue pictures for @s the city already knows. Same call site after poller,
   * webhook and Muse — never a parallel door.
   */
  enqueue(handles: readonly string[]): void {
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

  async warm(handles: readonly string[]): Promise<void> {
    this.enqueue(handles);
  }

  async refresh(handle: string): Promise<boolean> {
    if (!HANDLE_PATTERN.test(handle)) {
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
      logger.info('avatar_refreshed', {
        handle,
        bytes: image.bytes.length,
        via: this.discoveryEnabled ? 'discovery_or_page' : 'public_page',
      });
      return true;
    } catch (err) {
      logger.warn('avatar_refresh_failed', { handle, message: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  private pump(): void {
    if (this.pumping) {
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
    if (this.discoveryEnabled) {
      const viaDiscovery = await this.lookupDiscovery(handle);
      if (viaDiscovery) {
        return viaDiscovery;
      }
    }
    return this.lookupPublicPage(handle);
  }

  private async lookupDiscovery(handle: string): Promise<{ pictureUrl: string; name?: string; followersCount?: number } | null> {
    const url = new URL(`${this.options.graphBaseUrl}/${encodeURIComponent(this.options.igUserId ?? '')}`);
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

  /** Same cache target as Discovery: Instagram CDN URL from the public profile page. */
  private async lookupPublicPage(handle: string): Promise<{ pictureUrl: string; name?: string } | null> {
    const pageUrl = `https://www.instagram.com/${encodeURIComponent(handle)}/`;
    const response = await this.fetchImpl(pageUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!response.ok) {
      return null;
    }
    const html = await response.text();
    const og =
      /property=["']og:image["']\s+content=["']([^"']+)["']/i.exec(html) ??
      /content=["']([^"']+)["']\s+property=["']og:image["']/i.exec(html);
    const pictureUrl = og?.[1] ?? null;
    if (!pictureUrl || !isAllowedImageUrl(pictureUrl)) {
      return null;
    }
    const title = /property=["']og:title["']\s+content=["']([^"']+)["']/i.exec(html)?.[1];
    const name = title?.replace(/\s*\(@[a-z0-9._]+\)\s*.*$/i, '').trim().slice(0, 60);
    return { pictureUrl, name: name || undefined };
  }

  private async download(startUrl: string): Promise<{ bytes: Buffer; contentType: string }> {
    let current = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isAllowedImageUrl(current)) {
        throw new Error('Image URL left the allowed CDN.');
      }
      const response = await this.fetchImpl(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Referer: 'https://www.instagram.com/' },
      });
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
