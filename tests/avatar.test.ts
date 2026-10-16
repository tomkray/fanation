/**
 * Portrait cache: a low-resolution copy per @, queued, never an open search.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AvatarService, isAllowedImageUrl } from '../src/infrastructure/instagram/avatarService.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function service(fetchImpl: typeof fetch, maxLookupsPerHour = 2): AvatarService {
  const directory = mkdtempSync(path.join(tmpdir(), 'fanation-avatar-'));
  dirs.push(directory);
  return new AvatarService({
    directory,
    graphBaseUrl: 'https://graph.facebook.com/v23.0',
    igUserId: '17840000000000000',
    accessToken: 'test-token',
    maxLookupsPerHour,
    warmDelayMs: 0,
    fetchImpl,
  });
}

describe('avatar cache', () => {
  it('only accepts Instagram CDN picture URLs', () => {
    expect(isAllowedImageUrl('https://scontent.cdninstagram.com/v/portrait.jpg')).toBe(true);
    expect(isAllowedImageUrl('https://evil.example/portrait.jpg')).toBe(false);
    expect(isAllowedImageUrl('http://scontent.cdninstagram.com/v/portrait.jpg')).toBe(false);
  });

  it('stores a small copy and stops when the hourly cap is hit', async () => {
    let lookups = 0;
    const portraits = service(async (input) => {
      const url = String(input);
      if (url.includes('business_discovery')) {
        lookups += 1;
        const handle = /username\(([a-z0-9._]+)\)/.exec(url)?.[1] ?? 'fan';
        return new Response(
          JSON.stringify({
            business_discovery: {
              username: handle,
              name: 'Fan',
              profile_picture_url: 'https://scontent.cdninstagram.com/v/portrait.jpg',
              followers_count: 10,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(Uint8Array.from([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    });

    portraits.enqueue(['bts.bighitofficial', 'taylorswift', 'realmadrid']);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lookups).toBe(2);
    expect(portraits.read('bts.bighitofficial')?.contentType).toBe('image/jpeg');
    expect(portraits.read('realmadrid')).toBeNull();
  });
});
