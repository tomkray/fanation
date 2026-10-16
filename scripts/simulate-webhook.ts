/**
 * Sends Meta-shaped `comments` webhooks, signed with the local app secret, to
 * the running API, exactly as Instagram would. Proves the webhook door end to
 * end without a Meta app.
 *
 *   npm run simulate:webhook -- --count 5 --fandom bts.bighitofficial
 */

import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const DEV_SECRETS_PATH = 'data/.dev-secrets.json';

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function appSecret(): string {
  const fromEnv = process.env.NAOEUMFA_META_APP_SECRET;
  if (fromEnv) {
    return fromEnv;
  }
  if (existsSync(DEV_SECRETS_PATH)) {
    const secrets = JSON.parse(readFileSync(DEV_SECRETS_PATH, 'utf-8')) as Record<string, string>;
    if (secrets.NAOEUMFA_META_APP_SECRET) {
      return secrets.NAOEUMFA_META_APP_SECRET;
    }
  }
  throw new Error('No app secret: run `npm run dev` once or set NAOEUMFA_META_APP_SECRET.');
}

async function main(): Promise<void> {
  const count = Number.parseInt(argValue('count') ?? '3', 10);
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new Error('--count must be an integer between 1 and 50.');
  }
  const fandom = (argValue('fandom') ?? 'taylorswift').replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(fandom)) {
    throw new Error('--fandom must be an Instagram handle, e.g. taylorswift.');
  }
  const apiUrl = process.env.NAOEUMFA_API_URL ?? 'http://127.0.0.1:8787';
  const nowSeconds = Math.floor(Date.now() / 1000);

  const entry = Array.from({ length: count }, (_, i) => {
    const fan = `webhook_fan_${randomBytes(3).toString('hex')}`;
    return {
      id: 'naoeumfa_ig_account',
      time: nowSeconds + i,
      changes: [
        {
          field: 'comments',
          value: {
            id: `wh_${Date.now()}_${i}`,
            text: `@${fan} @${fandom} just landed via webhook!`,
            from: { id: `${1_000_000 + i}`, username: fan },
            media: { id: 'wh_post_1', media_product_type: 'FEED' },
          },
        },
      ],
    };
  });

  const raw = Buffer.from(JSON.stringify({ object: 'instagram', entry }));
  const signature = createHmac('sha256', appSecret()).update(raw).digest('hex');
  const response = await fetch(`${apiUrl}/api/v1/webhooks/instagram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${signature}` },
    body: raw,
  });
  console.log(`webhook → HTTP ${response.status}`, await response.text());
  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
