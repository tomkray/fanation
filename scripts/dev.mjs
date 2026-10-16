/**
 * `npm run dev`: API (tsx watch) + web (Vite) in one terminal. Demo secrets
 * are generated once into data/.dev-secrets.json (0600) so the webhook
 * simulator can sign requests the local API accepts.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const DEV_SECRETS_PATH = 'data/.dev-secrets.json';
const SECRET_NAMES = ['NAOEUMFA_META_APP_SECRET', 'NAOEUMFA_META_VERIFY_TOKEN', 'NAOEUMFA_PAYMENT_WEBHOOK_SECRET'];

function loadDevSecrets() {
  if (existsSync(DEV_SECRETS_PATH)) {
    return JSON.parse(readFileSync(DEV_SECRETS_PATH, 'utf-8'));
  }
  mkdirSync('data', { recursive: true });
  const secrets = Object.fromEntries(SECRET_NAMES.map((name) => [name, randomBytes(24).toString('hex')]));
  writeFileSync(DEV_SECRETS_PATH, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  return secrets;
}

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
// The toy turns the demo book on. A live Instagram collector must not.
const liveInstagram = process.env.NAOEUMFA_COMMENT_SOURCE === 'instagram';
const env = { ...process.env, NAOEUMFA_DEMO: process.env.NAOEUMFA_DEMO ?? (liveInstagram ? '0' : '1') };
for (const [name, value] of Object.entries(loadDevSecrets())) {
  env[name] ??= value;
}

const children = [
  spawn('npx', ['tsx', 'watch', '--clear-screen=false', 'src/infrastructure/http/main.ts'], { env, stdio: 'inherit' }),
  spawn('npx', ['vite'], { env, stdio: 'inherit' }),
];

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 500).unref();
}

for (const child of children) {
  child.on('exit', (code) => shutdown(code ?? 0));
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('\n  Não É Um Fã dev → web http://127.0.0.1:5173  ·  api http://127.0.0.1:8787\n');
