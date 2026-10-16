/**
 * Pushes a Muse (or hand-copied) comment JSON into the city on this machine.
 *
 *   npm run muse:ingest -- path/to/batch.json
 *
 * The running API must have FANATION_BRIDGE_SECRET set. The same dump twice
 * does not mint twice: missing Meta ids become a stable hash.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function main(): Promise<number> {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npm run muse:ingest -- path/to/batch.json');
    return 1;
  }
  const secret = process.env.FANATION_BRIDGE_SECRET?.trim();
  if (!secret || secret.length < 24) {
    console.error('FANATION_BRIDGE_SECRET missing or shorter than 24 characters in .env');
    return 1;
  }
  const path = resolve(file);
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    return 1;
  }
  const body = readFileSync(path, 'utf-8');
  JSON.parse(body);
  const apiUrl = (process.env.FANATION_API_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
  const response = await fetch(`${apiUrl}/api/v1/bridge/muse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
      'X-Naoeumfa-Client': 'muse-ingest',
    },
    body,
    // Bridge now awaits AvatarService.refresh for each portrait — allow headroom.
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Keep raw text when the server did not return JSON.
  }
  if (!response.ok) {
    console.error(`✗ HTTP ${response.status}`, parsed);
    return 1;
  }
  console.log('✓ Muse batch applied', parsed);
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
