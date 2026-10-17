/**
 * Operator escape hatch into the SAME AvatarService cache the API uses.
 * Prefer: mint via Muse/poller → server enqueue → refresh (automatic).
 *
 *   npm run avatar:seed -- tomkray
 *   npm run avatar:seed -- tomkray ./photo.jpg --name "Tom Kray"
 *
 * Without a file/URL, runs AvatarService.refresh (Discovery or public page).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { AvatarService } from '../src/infrastructure/instagram/avatarService.js';

const HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/;

function parseArgs(argv: string[]): { handle: string; source: string | null; name: string | undefined; instagramVerified: boolean | null } {
  const positional: string[] = [];
  let name: string | undefined;
  let instagramVerified: boolean | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--verified') {
      instagramVerified = true;
      continue;
    }
    if (arg === '--not-verified') {
      instagramVerified = false;
      continue;
    }
    if (arg === '--name' || arg.startsWith('--name=')) {
      if (arg.startsWith('--name=') && arg.length > '--name='.length) {
        name = arg.slice('--name='.length);
        continue;
      }
      const parts: string[] = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        parts.push(argv[++i]);
      }
      name = parts.join(' ') || undefined;
      continue;
    }
    positional.push(arg);
  }
  return {
    handle: (positional[0] ?? '').trim().toLowerCase().replace(/^@/, ''),
    source: positional[1] ?? null,
    name,
    instagramVerified,
  };
}

function sniff(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return 'image/png';
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

async function main(): Promise<number> {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const { handle, source, name, instagramVerified } = parseArgs(process.argv.slice(2));
  if (!HANDLE_PATTERN.test(handle)) {
    console.error('Usage: npm run avatar:seed -- <handle> [file-or-url] [--name "Display Name"] [--verified|--not-verified]');
    return 1;
  }
  const portraits = new AvatarService({
    directory: path.resolve(process.env.NAOEUMFA_AVATAR_DIR ?? 'data/avatars'),
    graphBaseUrl: process.env.NAOEUMFA_DISCOVERY_BASE_URL ?? 'https://graph.facebook.com/v23.0',
    igUserId: process.env.NAOEUMFA_DISCOVERY_IG_USER_ID?.trim() || null,
    accessToken: process.env.NAOEUMFA_DISCOVERY_ACCESS_TOKEN?.trim() || null,
    warmDelayMs: 0,
  });

  if (source) {
    let bytes: Buffer;
    let contentType: string | null;
    if (/^https?:\/\//i.test(source)) {
      const res = await fetch(source, {
        headers: { Accept: 'image/*', Referer: 'https://www.instagram.com/' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        console.error(`✗ HTTP ${res.status} fetching source`);
        return 1;
      }
      bytes = Buffer.from(await res.arrayBuffer());
      contentType = sniff(bytes) ?? res.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? null;
    } else {
      const filePath = path.resolve(source);
      if (!existsSync(filePath)) {
        console.error(`✗ File not found: ${filePath}`);
        return 1;
      }
      bytes = readFileSync(filePath);
      contentType = sniff(bytes);
    }
    if (!contentType) {
      console.error('✗ Source is not jpeg/png/webp');
      return 1;
    }
    portraits.seed(handle, bytes, contentType, name, instagramVerified ?? undefined);
    console.log(`✓ Seeded @${handle} into AvatarService cache (${bytes.length} bytes)`);
    return 0;
  }

  if (instagramVerified !== null) {
    portraits.setInstagramVerified(handle, instagramVerified);
    console.log(`✓ @${handle} Instagram verified=${instagramVerified}`);
    return 0;
  }

  const ok = await portraits.refresh(handle);
  if (!ok) {
    console.error(`✗ refresh failed for @${handle}`);
    return 1;
  }
  console.log(`✓ Refreshed @${handle} via AvatarService (same pipeline as the live API)`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
