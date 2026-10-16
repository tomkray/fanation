/**
 * Environment configuration. Outside demo mode every secret is mandatory and
 * the process refuses to boot without it.
 */

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { PaymentMethod } from '../core/types.js';

export type CommentSourceMode = 'instagram' | 'simulated' | 'off';
export type TokenTransport = 'query' | 'header';

export const OFFICIAL_INSTAGRAM_HANDLE = 'fanation.club';
/** Instagram API with Instagram Login: our own professional account, no Facebook Page needed. */
export const DEFAULT_GRAPH_BASE_URL = 'https://graph.instagram.com/v23.0';

export interface CryptoRail {
  readonly network: string;
  readonly address: string;
}

export interface AppConfig {
  readonly demo: boolean;
  /** Toys (fake listings, simulate payment, simulate Connect) only while fans are simulated. */
  readonly sandbox: boolean;
  readonly host: string;
  readonly port: number;
  readonly journalPath: string;
  readonly staticDir: string;
  /** Profile pictures + verified names via Business Discovery (Facebook-login Graph token). */
  readonly avatars: {
    readonly directory: string;
    readonly graphBaseUrl: string;
    readonly igUserId: string | null;
    readonly accessToken: string | null;
  };
  readonly meta: {
    readonly appSecret: string;
    readonly verifyToken: string;
    readonly graphBaseUrl: string;
    readonly tokenTransport: TokenTransport;
    readonly igUserId: string | null;
    readonly igAccessToken: string | null;
    readonly officialUsername: string | null;
  };
  readonly commentSource: CommentSourceMode;
  /** Instagram comments older than this are ignored. Null only while the demo is on. */
  readonly liveFromMs: number | null;
  readonly pollIntervalSeconds: number;
  readonly pollMediaLimit: number;
  /** Ranking movement (▲▼, %) is measured against the ranking this long ago. */
  readonly momentumWindowSeconds: number;
  /** The map reorganizes itself around the fan tree once per epoch of comment time (A3). */
  readonly layoutEpochSeconds: number;
  /** A $FANT season (A11): reputation earned in it is paid out when it ends. */
  readonly seasonSeconds: number;
  /** Bearer token for /api/v1/admin/*; admin routes are off when unset. */
  readonly adminToken: string | null;
  /**
   * Local Muse dump door. Off when unset. Never put this in a public frontend;
   * the route only accepts the secret header.
   */
  readonly bridgeSecret: string | null;
  readonly adsPath: string;
  readonly payments: {
    readonly webhookSecret: string;
    /** Null in demo mode: checkout then uses an all-zero EVP key nobody can own. */
    readonly pixKey: string | null;
    readonly pixMerchantName: string;
    readonly pixMerchantCity: string;
    readonly cryptoRails: Readonly<Partial<Record<Exclude<PaymentMethod, 'PIX'>, CryptoRail>>>;
  };
}

export const DEMO_PIX_EVP_KEY = '00000000-0000-0000-0000-000000000000';

function readEnv(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function requireSecret(env: NodeJS.ProcessEnv, name: string, demo: boolean, minLength = 16): string {
  const value = readEnv(env, name);
  if (value && value.length >= minLength) {
    return value;
  }
  if (demo) {
    // Random per boot: demo secrets are never predictable, even on localhost.
    return randomBytes(24).toString('hex');
  }
  throw new Error(`${name} is required (min ${minLength} chars) outside demo mode.`);
}

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = readEnv(env, name);
  if (raw === null) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}], got "${raw}".`);
  }
  return parsed;
}

/** Too short a token is refused rather than silently weak: admin routes approve paid content. */
function readAdminToken(env: NodeJS.ProcessEnv): string | null {
  const value = readEnv(env, 'FANATION_ADMIN_TOKEN');
  if (value !== null && value.length < 24) {
    throw new Error('FANATION_ADMIN_TOKEN must be at least 24 characters (or unset to disable admin routes).');
  }
  return value;
}

/** Optional local door for Muse comment dumps. Off when unset. */
function readBridgeSecret(env: NodeJS.ProcessEnv): string | null {
  const value = readEnv(env, 'FANATION_BRIDGE_SECRET');
  if (value !== null && value.length < 24) {
    throw new Error('FANATION_BRIDGE_SECRET must be at least 24 characters (or unset to disable the Muse bridge).');
  }
  return value;
}

function metaSecret(env: NodeJS.ProcessEnv, name: string, commentSource: CommentSourceMode, demo: boolean): string {
  if (commentSource === 'instagram') {
    return requireSecret(env, name, false);
  }
  return readEnv(env, name) ?? (demo ? requireSecret(env, name, true) : '');
}

function readCryptoRail(env: NodeJS.ProcessEnv, prefix: string): CryptoRail | undefined {
  const address = readEnv(env, `${prefix}_ADDRESS`);
  const network = readEnv(env, `${prefix}_NETWORK`);
  return address && network ? { address, network } : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const demo = env.FANATION_DEMO === '1';
  const igAccessToken = readEnv(env, 'FANATION_IG_ACCESS_TOKEN');
  // `me` resolves to the token's own account, so a token alone is enough.
  const igUserId = readEnv(env, 'FANATION_IG_USER_ID') ?? (igAccessToken ? 'me' : null);
  const transport = readEnv(env, 'FANATION_GRAPH_TOKEN_TRANSPORT') ?? 'query';
  if (transport !== 'query' && transport !== 'header') {
    throw new Error(`FANATION_GRAPH_TOKEN_TRANSPORT must be query | header, got "${transport}".`);
  }

  const requestedSource = readEnv(env, 'FANATION_COMMENT_SOURCE');
  let commentSource: CommentSourceMode;
  if (requestedSource === 'instagram' || requestedSource === 'simulated' || requestedSource === 'off') {
    commentSource = requestedSource;
  } else if (requestedSource !== null) {
    throw new Error(`FANATION_COMMENT_SOURCE must be instagram | simulated | off, got "${requestedSource}".`);
  } else if (igAccessToken && igUserId) {
    commentSource = 'instagram';
  } else {
    commentSource = demo ? 'simulated' : 'off';
  }
  if (commentSource === 'instagram' && (!igAccessToken || !igUserId)) {
    throw new Error('FANATION_COMMENT_SOURCE=instagram needs FANATION_IG_ACCESS_TOKEN and FANATION_IG_USER_ID.');
  }
  if (commentSource === 'simulated' && !demo) {
    throw new Error('The simulated comment source is only allowed with FANATION_DEMO=1.');
  }

  const pixKey = readEnv(env, 'FANATION_PIX_KEY');
  const liveFromRaw = readEnv(env, 'FANATION_LIVE_FROM');
  const liveFromMs = liveFromRaw === null ? null : Date.parse(liveFromRaw);
  if (liveFromRaw !== null && !Number.isFinite(liveFromMs)) {
    throw new Error('FANATION_LIVE_FROM must be an ISO-8601 instant.');
  }
  if (commentSource === 'instagram' && liveFromMs === null) {
    throw new Error('FANATION_LIVE_FROM is required when reading Instagram. Set it to the minute the planet opens, so older comments do not mint the first homes.');
  }
  const officialUsername = readEnv(env, 'FANATION_IG_USERNAME') ?? OFFICIAL_INSTAGRAM_HANDLE;
  // Simulated fans live in their own book, so the real city starts at plot #0.
  const defaultJournal = commentSource === 'simulated' ? 'data/ledger.demo.jsonl' : 'data/ledger.jsonl';

  return {
    demo,
    sandbox: demo && commentSource === 'simulated',
    host: readEnv(env, 'HOST') ?? '127.0.0.1',
    port: readInt(env, 'PORT', 8787, 1, 65_535),
    journalPath: path.resolve(readEnv(env, 'FANATION_JOURNAL_PATH') ?? defaultJournal),
    staticDir: path.resolve(readEnv(env, 'FANATION_STATIC_DIR') ?? 'dist'),
    avatars: {
      directory: path.resolve(readEnv(env, 'FANATION_AVATAR_DIR') ?? 'data/avatars'),
      graphBaseUrl: readEnv(env, 'FANATION_DISCOVERY_BASE_URL') ?? 'https://graph.facebook.com/v23.0',
      igUserId: readEnv(env, 'FANATION_DISCOVERY_IG_USER_ID'),
      accessToken: readEnv(env, 'FANATION_DISCOVERY_ACCESS_TOKEN'),
    },
    meta: {
      appSecret: metaSecret(env, 'FANATION_META_APP_SECRET', commentSource, demo),
      verifyToken: metaSecret(env, 'FANATION_META_VERIFY_TOKEN', commentSource, demo),
      graphBaseUrl: readEnv(env, 'FANATION_GRAPH_BASE_URL') ?? DEFAULT_GRAPH_BASE_URL,
      tokenTransport: transport,
      igUserId,
      igAccessToken,
      officialUsername: officialUsername.replace(/^@/, '').toLowerCase(),
    },
    commentSource,
    liveFromMs,
    pollIntervalSeconds: readInt(env, 'FANATION_POLL_INTERVAL_SECONDS', commentSource === 'simulated' ? 6 : 60, 2, 86_400),
    pollMediaLimit: readInt(env, 'FANATION_POLL_MEDIA_LIMIT', 10, 1, 50),
    momentumWindowSeconds: readInt(env, 'FANATION_MOMENTUM_WINDOW_SECONDS', commentSource === 'simulated' ? 60 : 3_600, 10, 604_800),
    layoutEpochSeconds: readInt(env, 'FANATION_LAYOUT_EPOCH_SECONDS', commentSource === 'simulated' ? 60 : 600, 10, 604_800),
    seasonSeconds: readInt(env, 'FANATION_SEASON_SECONDS', commentSource === 'simulated' ? 300 : 604_800, 60, 31_536_000),
    adminToken: readAdminToken(env),
    bridgeSecret: readBridgeSecret(env),
    adsPath: env.FANATION_ADS_PATH?.trim() || 'data/ads.json',
    payments: {
      webhookSecret:
        pixKey !== null || readCryptoRail(env, 'FANATION_USDT') || readCryptoRail(env, 'FANATION_USDC') || readCryptoRail(env, 'FANATION_BTC')
          ? requireSecret(env, 'FANATION_PAYMENT_WEBHOOK_SECRET', demo)
          : (readEnv(env, 'FANATION_PAYMENT_WEBHOOK_SECRET') ?? ''),
      pixKey,
      pixMerchantName: readEnv(env, 'FANATION_PIX_MERCHANT_NAME') ?? 'FANATION CLUB',
      pixMerchantCity: readEnv(env, 'FANATION_PIX_MERCHANT_CITY') ?? 'SAO PAULO',
      cryptoRails: {
        USDT: readCryptoRail(env, 'FANATION_USDT'),
        USDC: readCryptoRail(env, 'FANATION_USDC'),
        BTC: readCryptoRail(env, 'FANATION_BTC'),
      },
    },
  };
}
