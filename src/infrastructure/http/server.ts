/**
 * Não É Um Fã HTTP API (Node native http).
 *
 *   GET  /healthz
 *   GET  /api/v1/config
 *   GET  /api/v1/world                summary: rankings, live feed, cities, chunk lights (alias /api/v1/city)
 *   GET  /api/v1/world/chunks?keys=   properties of the chunks the camera sees
 *   GET  /api/v1/world/changes?since= properties changed after a version
 *   GET  /api/v1/properties/:plot     one property and the profile living in it
 *   GET  /api/v1/profiles/:handle     the same, by @handle
 *   GET  /api/v1/avatars/:handle      cached Instagram profile picture
 *   GET  /api/v1/stream               Server-Sent Events: `city` on every change
 *   GET  /api/v1/webhooks/instagram   Meta subscription handshake
 *   POST /api/v1/webhooks/instagram   Meta `comments` + Direct `messages` webhook (HMAC verified)
 *   POST /api/v1/market/checkout      lock a listing and return PIX / crypto instructions
 *   POST /api/v1/payments/webhook     signed PSP callback → settlement
 *   POST /api/v1/dev/simulate-payment demo only: signs a PSP callback for the active checkout
 *   GET  /api/v1/ads                  live ads (zeppelins, billboards, sky banners) + rate card
 *   POST /api/v1/ads/requests         a partner books a placement → quote, pending review
 *   GET  /api/v1/admin/ads            admin: every campaign (Bearer NAOEUMFA_ADMIN_TOKEN)
 *   POST /api/v1/admin/ads/:id/approve|reject  admin: review a campaign
 *   POST /api/v1/bridge/muse          local Muse dump (Bearer NAOEUMFA_BRIDGE_SECRET)
 *   GET  /*                           built frontend from `dist/` when present
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import path from 'node:path';
import { validateAdRequest } from '../../core/ads.js';
import { MarketError, priceForMethod } from '../../core/marketplace.js';
import { PublicConfigDto, WorldSummaryDto } from '../../shared/apiContract.js';
import { logger } from '../../utils/logger.js';
import { CityService } from '../cityService.js';
import { AdNotFoundError, AdQueueFullError, AdService } from '../ads/adService.js';
import { AuthLimitError, AuthService } from '../auth/authService.js';
import { DmLoginService } from '../auth/dmLogin.js';
import { AppConfig } from '../config.js';
import { AvatarService } from '../instagram/avatarService.js';
import { OfferError, OfferService } from '../market/offerService.js';
import { header, HttpError, JSON_BODY_LIMIT, parseJson, readRawBody, sendError, sendJson } from './httpKit.js';
import { handleWalletRoute, requireAppClient, requireSession, WalletContext } from './walletRoutes.js';
import { parseMuseBatch } from '../instagram/museBridge.js';
import {
  parseMetaCommentWebhook,
  parseMetaMessageWebhook,
  resolveSubscriptionChallenge,
  verifyHmacSha256Hex,
  verifyMetaSignature,
} from '../instagram/metaWebhook.js';
import {
  buildCheckoutInstructions,
  isPaymentMethod,
  parsePaymentCallback,
  PaymentCallbackError,
  PaymentRailUnavailableError,
  paymentRailsStatus,
} from '../payments/payments.js';

const WEBHOOK_BODY_LIMIT = 1_048_576;
const MAX_SSE_CLIENTS = 500;
const SSE_HEARTBEAT_MS = 25_000;

const STATIC_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

const MARKET_ERROR_STATUS: Readonly<Record<MarketError['code'], number>> = {
  SELLER_NOT_OWNER: 409,
  INVALID_PRICE: 400,
  INVALID_ASSET: 400,
  INSUFFICIENT_BALANCE: 409,
  ALREADY_LISTED: 409,
  LISTING_NOT_FOUND: 404,
  LISTING_UNAVAILABLE: 409,
  LISTING_LOCKED: 409,
  WASH_TRADE: 400,
  LOCK_MISMATCH: 409,
  UNDERPAID: 402,
  INVALID_TX_REF: 400,
};

const CHUNK_KEY_PATTERN = /^-?\d{1,6}:-?\d{1,6}$/;
const PROPERTY_ROUTE = /^\/api\/v1\/properties\/(\d{1,10})$/;
const PROFILE_ROUTE = /^\/api\/v1\/profiles\/([a-z0-9._]{1,30})$/;
const AVATAR_ROUTE = /^\/api\/v1\/avatars\/([a-z0-9._]{1,30})$/;
const AD_REVIEW_ROUTE = /^\/api\/v1\/admin\/ads\/(ad_[0-9a-f]{16})\/(approve|reject)$/;

export interface NaoeumfaServices {
  readonly city: CityService;
  readonly avatars: AvatarService;
  readonly ads: AdService;
  readonly auth: AuthService;
  readonly offers: OfferService;
  /** Null until the official account's token can read and answer Direct. */
  readonly dmLogin: DmLoginService | null;
}

export function createNaoeumfaServer(config: AppConfig, services: NaoeumfaServices): Server {
  const { city, avatars, ads, auth, offers, dmLogin } = services;
  const wallet: WalletContext = { config, city, auth, offers };
  /** Constant-time check of `Authorization: Bearer <NAOEUMFA_ADMIN_TOKEN>`; hashing equalises lengths. */
  function requireAdmin(req: IncomingMessage): void {
    if (!config.adminToken) {
      throw new HttpError(404, 'NOT_FOUND', 'Route not found.');
    }
    const given = createHash('sha256').update(header(req, 'authorization') ?? '').digest();
    const expected = createHash('sha256').update(`Bearer ${config.adminToken}`).digest();
    if (!timingSafeEqual(given, expected)) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Admin token required.');
    }
  }

  function requireBridge(req: IncomingMessage): void {
    if (!config.bridgeSecret) {
      throw new HttpError(404, 'NOT_FOUND', 'Route not found.');
    }
    const given = createHash('sha256').update(header(req, 'authorization') ?? '').digest();
    const expected = createHash('sha256').update(`Bearer ${config.bridgeSecret}`).digest();
    if (!timingSafeEqual(given, expected)) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Bridge token required.');
    }
  }

  const sseClients = new Set<ServerResponse>();

  /** Prefer the name Instagram itself reports, and pass through who Instagram has verified. */
  function withVerifiedNames(summary: WorldSummaryDto): WorldSummaryDto {
    return {
      ...summary,
      standings: summary.standings.map((s) => ({ ...s, displayName: avatars.verifiedName(s.fandomHandle) ?? s.displayName })),
      instagramVerified: avatars.instagramVerifiedHandles(),
    };
  }

  city.subscribe((version) => {
    const frame = `event: city\ndata: ${JSON.stringify({ version })}\n\n`;
    for (const client of sseClients) {
      client.write(frame);
    }
  });

  const heartbeat = setInterval(() => {
    for (const client of sseClients) {
      client.write(': keep-alive\n\n');
    }
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref();

  const publicConfig: PublicConfigDto = {
    brand: { name: 'Não É Um Fã', domain: 'naoeumfa.com' },
    demo: config.sandbox,
    commentSource: config.commentSource,
    pollIntervalSeconds: config.pollIntervalSeconds,
    momentumWindowSeconds: config.momentumWindowSeconds,
    // Fetch pipeline is always on (Discovery or public-page interim).
    avatars: avatars.enabled,
    paymentRails: paymentRailsStatus(config),
    login: {
      officialHandle: config.meta.officialUsername ?? 'naoeumfa',
      directUrl: `https://ig.me/m/${config.meta.officialUsername ?? 'naoeumfa'}`,
      // Both halves are needed: the token answers, the app secret proves the message came from Meta.
      ready: dmLogin !== null && config.meta.appSecret.length >= 16,
      canSimulate: config.sandbox,
    },
  };

  function handlePaymentCallback(rawBody: Buffer, signatureHex: string | undefined): { status: number; body: unknown } {
    if (!signatureHex || !verifyHmacSha256Hex(config.payments.webhookSecret, rawBody, signatureHex.trim())) {
      logger.security('payment_webhook_signature_invalid');
      return { status: 401, body: { error: 'Invalid signature.', code: 'INVALID_SIGNATURE' } };
    }
    const proof = parsePaymentCallback(parseJson(rawBody), new Date().toISOString());
    const receipt = city.settlePayment(proof);
    if (receipt === null) {
      return { status: 200, body: { duplicate: true } };
    }
    logger.info('payment_settled', {
      listingId: receipt.listing.listingId,
      method: receipt.paymentMethod,
      feeInteger: receipt.platformFeeInteger.toString(),
      excessToRefundInteger: receipt.excessToRefundInteger.toString(),
    });
    return {
      status: 200,
      body: {
        listingId: receipt.listing.listingId,
        status: receipt.listing.status,
        platformFeeInteger: receipt.platformFeeInteger.toString(),
        sellerNetPayoutInteger: receipt.sellerNetPayoutInteger.toString(),
        excessToRefundInteger: receipt.excessToRefundInteger.toString(),
      },
    };
  }

  function serveStatic(pathname: string, res: ServerResponse): boolean {
    if (!existsSync(config.staticDir)) {
      return false;
    }
    const root = config.staticDir;
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    let target = path.resolve(root, `.${decoded}`);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      return false;
    }
    if (!existsSync(target) || statSync(target).isDirectory()) {
      target = path.join(root, 'index.html');
      if (!existsSync(target)) {
        return false;
      }
    }
    res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(target)] ?? 'application/octet-stream' });
    createReadStream(target).pipe(res);
    return true;
  }

  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');

    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = `${req.method ?? 'GET'} ${url.pathname}`;
      try {
        if (await handleWalletRoute(wallet, req, res, url)) {
          return;
        }
        const property = req.method === 'GET' ? PROPERTY_ROUTE.exec(url.pathname) : null;
        if (property) {
          const plot = Number.parseInt(property[1], 10);
          const detail = city.propertyDetail(plot, offers.pendingCount(plot));
          return detail ? sendJson(res, 200, detail) : sendError(res, 404, 'NOT_FOUND', 'No such property.');
        }
        const profile = req.method === 'GET' ? PROFILE_ROUTE.exec(url.pathname) : null;
        if (profile) {
          const plot = city.stateView.plotIndexByMinter.get(profile[1]);
          const detail = city.profileDetail(profile[1], plot === undefined ? 0 : offers.pendingCount(plot));
          return detail ? sendJson(res, 200, detail) : sendError(res, 404, 'NOT_FOUND', 'This @ has no property yet.');
        }
        const avatar = req.method === 'GET' ? AVATAR_ROUTE.exec(url.pathname) : null;
        if (avatar) {
          const image = avatars.read(avatar[1]);
          if (!image) {
            if (avatars.enabled && city.knowsHandle(avatar[1])) {
              avatars.enqueue([avatar[1]]);
            }
            res.setHeader('Cache-Control', 'no-store');
            return sendError(res, 404, 'NO_AVATAR', 'No profile picture for this @.');
          }
          res.writeHead(200, { 'Content-Type': image.contentType, 'Cache-Control': 'public, max-age=3600' });
          res.end(image.bytes);
          return;
        }
        const review = req.method === 'POST' ? AD_REVIEW_ROUTE.exec(url.pathname) : null;
        if (review) {
          requireAdmin(req);
          try {
            return sendJson(res, 200, ads.review(review[1], review[2] === 'approve' ? 'APPROVED' : 'REJECTED'));
          } catch (err) {
            if (err instanceof AdNotFoundError) {
              return sendError(res, 404, 'NOT_FOUND', err.message);
            }
            throw err;
          }
        }
        switch (route) {
          case 'GET /api/v1/ads':
            sendJson(res, 200, ads.publicAds());
            return;

          case 'POST /api/v1/ads/requests': {
            const validation = validateAdRequest(parseJson(await readRawBody(req, JSON_BODY_LIMIT)));
            if (!validation.ok) {
              throw new HttpError(400, 'INVALID_AD_REQUEST', validation.error);
            }
            try {
              sendJson(res, 201, ads.request(validation.request));
            } catch (err) {
              if (err instanceof AdQueueFullError) {
                throw new HttpError(429, 'AD_QUEUE_FULL', err.message);
              }
              throw err;
            }
            return;
          }

          case 'GET /api/v1/admin/ads':
            requireAdmin(req);
            sendJson(res, 200, { campaigns: ads.all() });
            return;

          case 'GET /healthz':
            sendJson(res, 200, { ok: true, version: city.currentVersion, demo: config.demo });
            return;

          case 'GET /api/v1/config':
            sendJson(res, 200, publicConfig);
            return;

          case 'GET /api/v1/world':
          case 'GET /api/v1/city':
            sendJson(res, 200, withVerifiedNames(city.summary()));
            return;

          case 'GET /api/v1/world/chunks': {
            const keys = (url.searchParams.get('keys') ?? '').split(',').filter((k) => CHUNK_KEY_PATTERN.test(k));
            if (keys.length === 0) {
              throw new HttpError(400, 'INVALID_CHUNKS', 'keys must list chunk keys like 0:-1.');
            }
            sendJson(res, 200, city.chunksByKey(keys));
            return;
          }

          case 'GET /api/v1/world/changes': {
            const since = Number.parseInt(url.searchParams.get('since') ?? '', 10);
            if (!Number.isInteger(since) || since < 0) {
              throw new HttpError(400, 'INVALID_SINCE', 'since must be a version number.');
            }
            sendJson(res, 200, city.changesSince(since));
            return;
          }

          case 'GET /api/v1/stream': {
            if (sseClients.size >= MAX_SSE_CLIENTS) {
              sendError(res, 503, 'TOO_MANY_STREAMS', 'Live stream is full, retry shortly.');
              return;
            }
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
            });
            res.write(`retry: 3000\nevent: city\ndata: ${JSON.stringify({ version: city.currentVersion })}\n\n`);
            sseClients.add(res);
            req.on('close', () => sseClients.delete(res));
            return;
          }

          case 'GET /api/v1/webhooks/instagram': {
            const challenge = resolveSubscriptionChallenge(url.searchParams, config.meta.verifyToken);
            if (challenge === null) {
              sendError(res, 403, 'VERIFY_FAILED', 'Subscription verification failed.');
              return;
            }
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(challenge);
            return;
          }

          case 'POST /api/v1/webhooks/instagram': {
            const raw = await readRawBody(req, WEBHOOK_BODY_LIMIT);
            if (!verifyMetaSignature(config.meta.appSecret, raw, header(req, 'x-hub-signature-256'))) {
              sendError(res, 401, 'INVALID_SIGNATURE', 'Invalid X-Hub-Signature-256.');
              return;
            }
            const body = parseJson(raw);
            const messages = parseMetaMessageWebhook(body);
            if (messages.length > 0 && !dmLogin) {
              logger.warn('dm_login_off', { messages: messages.length });
            }
            for (const message of messages) {
              // Answer Meta at once; the link goes out on its own.
              dmLogin?.onMessage(message).catch((err: unknown) => {
                logger.error('dm_login_failed', { message: err instanceof Error ? err.message : String(err) });
              });
            }
            const events = parseMetaCommentWebhook(body);
            const outcomes = city.ingestComments(events, 'instagram_webhook');
            const portraits: string[] = [];
            for (const outcome of outcomes) {
              if (outcome.status !== 'REJECTED') {
                portraits.push(outcome.land.minterHandle, outcome.idol.minterHandle, outcome.land.ownerHandle);
              }
            }
            if (portraits.length > 0) {
              avatars.enqueue(portraits);
            }
            sendJson(res, 200, { received: events.length, applied: outcomes.length, messages: messages.length });
            return;
          }

          case 'POST /api/v1/market/checkout': {
            // The buyer is whoever proved their @ (A10), never a name typed into a form.
            requireAppClient(config, req);
            const buyer = requireSession(auth, req);
            const body = parseJson(await readRawBody(req, JSON_BODY_LIMIT));
            if (typeof body !== 'object' || body === null) {
              throw new HttpError(400, 'INVALID_BODY', 'Body must be a JSON object.');
            }
            const { listingId, paymentMethod } = body as Record<string, unknown>;
            if (typeof listingId !== 'string' || !isPaymentMethod(paymentMethod)) {
              throw new HttpError(400, 'INVALID_CHECKOUT', 'listingId and paymentMethod are required.');
            }
            if (city.getListing(listingId)?.sellerHandle === buyer) {
              throw new HttpError(409, 'OWN_LISTING', 'This listing is yours.');
            }
            if (!publicConfig.paymentRails[paymentMethod]) {
              throw new PaymentRailUnavailableError(paymentMethod);
            }
            const checkoutRef = `FAN${randomBytes(9).toString('hex').toUpperCase()}`;
            const locked = city.lockCheckout({
              listingId,
              buyerHandle: buyer,
              paymentMethod,
              checkoutRef,
              nowMs: Date.now(),
            });
            if (!locked.lock) {
              throw new Error('Checkout lock missing after lockCheckout.');
            }
            sendJson(res, 200, buildCheckoutInstructions(config, locked, paymentMethod, checkoutRef, locked.lock.expiresAtMs));
            return;
          }

          case 'POST /api/v1/payments/webhook': {
            const raw = await readRawBody(req, JSON_BODY_LIMIT);
            const result = handlePaymentCallback(raw, header(req, 'x-naoeumfa-signature'));
            sendJson(res, result.status, result.body);
            return;
          }

          case 'POST /api/v1/bridge/muse': {
            requireBridge(req);
            const parsed = parseMuseBatch(parseJson(await readRawBody(req, JSON_BODY_LIMIT)));
            if (!parsed.ok) {
              throw new HttpError(400, 'INVALID_MUSE_BATCH', parsed.error);
            }
            const outcomes = city.ingestComments(parsed.events, 'muse_bridge');
            const tally = { minted: 0, points: 0, rejected: 0 };
            const portraits: string[] = [];
            for (const outcome of outcomes) {
              if (outcome.status === 'MINTED_NEW_LAND') {
                tally.minted += 1;
              } else if (outcome.status === 'ENGAGEMENT_POINTS_ONLY') {
                tally.points += 1;
              } else {
                tally.rejected += 1;
              }
              if (outcome.status !== 'REJECTED') {
                // Same enqueue as the Instagram poller / webhook — one avatar pipeline.
                portraits.push(outcome.land.minterHandle, outcome.idol.minterHandle, outcome.land.ownerHandle);
              }
            }
            // Same portrait pipeline as the live poller: enqueue + refresh now so
            // Muse feels identical to Graph (faces land before the HTTP answer).
            const uniquePortraits = [...new Set(portraits)];
            if (uniquePortraits.length > 0) {
              avatars.enqueue(uniquePortraits);
            }
            const avatarOk: string[] = [];
            const avatarMissing: string[] = [];
            for (const handle of uniquePortraits) {
              if (avatars.read(handle) || (await avatars.refresh(handle))) {
                avatarOk.push(handle);
              } else {
                avatarMissing.push(handle);
              }
            }
            sendJson(res, 200, {
              mediaId: parsed.mediaId,
              received: parsed.events.length,
              applied: outcomes.length,
              ...tally,
              avatars: { ok: avatarOk, missing: avatarMissing },
              version: city.currentVersion,
            });
            return;
          }

          case 'POST /api/v1/dev/simulate-payment': {
            if (!config.sandbox) {
              sendError(res, 404, 'NOT_FOUND', 'Route not found.');
              return;
            }
            const body = parseJson(await readRawBody(req, JSON_BODY_LIMIT));
            const listingId = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).listingId : null;
            const listing = typeof listingId === 'string' ? city.getListing(listingId) : undefined;
            if (!listing || !listing.lock) {
              throw new HttpError(409, 'NO_ACTIVE_CHECKOUT', 'Listing has no active checkout to pay.');
            }
            const amount = priceForMethod(listing, listing.lock.paymentMethod);
            const callback = Buffer.from(JSON.stringify({
              listingId: listing.listingId,
              buyerHandle: listing.lock.buyerHandle,
              paymentMethod: listing.lock.paymentMethod,
              paidAmountInteger: amount.toString(),
              externalTxRef: `DEMO-${listing.lock.checkoutRef}`,
            }));
            const signature = createHmac('sha256', config.payments.webhookSecret).update(callback).digest('hex');
            const result = handlePaymentCallback(callback, signature);
            sendJson(res, result.status, result.body);
            return;
          }

          default:
            if (req.method === 'GET' && !url.pathname.startsWith('/api/') && serveStatic(url.pathname, res)) {
              return;
            }
            sendError(res, 404, 'NOT_FOUND', 'Route not found.');
        }
      } catch (err) {
        if (err instanceof HttpError) {
          sendError(res, err.status, err.code, err.message);
        } else if (err instanceof MarketError) {
          sendError(res, MARKET_ERROR_STATUS[err.code], err.code, err.message);
        } else if (err instanceof PaymentCallbackError) {
          sendError(res, 400, 'INVALID_CALLBACK', err.message);
        } else if (err instanceof PaymentRailUnavailableError) {
          sendError(res, 503, 'RAIL_NOT_CONFIGURED', err.message);
        } else if (err instanceof OfferError) {
          sendError(res, err.status, 'OFFER_REJECTED', err.message);
        } else if (err instanceof AuthLimitError) {
          sendError(res, 429, 'AUTH_LIMIT', err.message);
        } else {
          logger.error('http_unhandled_error', { route, message: err instanceof Error ? err.message : String(err) });
          if (!res.headersSent) {
            sendError(res, 500, 'INTERNAL', 'Internal server error.');
          } else {
            res.end();
          }
        }
      }
    })();
  });

  server.on('close', () => clearInterval(heartbeat));
  return server;
}
