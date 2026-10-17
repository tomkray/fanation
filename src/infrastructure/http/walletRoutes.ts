/**
 * Connect + profile wallet routes (Axiom A10).
 *
 *   POST /api/v1/auth/link/peek          { token } → which @ a Direct login link signs in as
 *   POST /api/v1/auth/link/redeem        { token } → uses the link once, sets the session cookie
 *   POST /api/v1/auth/logout
 *   POST /api/v1/dev/auth/link           demo only: { handle } → a link without Instagram
 *   GET  /api/v1/me                      the signed-in profile (stats, properties, listings, offers)
 *   POST /api/v1/me/listings             { plotIndex, priceBrlCents } list a property you own
 *   POST /api/v1/me/listings/:id/cancel
 *   POST /api/v1/me/transfers            { toHandle, amountMicro } send $NEFA
 *   POST /api/v1/me/lots/:plot/ad        { headline, tagline, backgroundHex, accentHex }
 *   DELETE /api/v1/me/lots/:plot/ad
 *   POST /api/v1/properties/:plot/offers { amountBrlCents } make an offer
 *   POST /api/v1/me/offers/:id/accept|decline|withdraw
 *
 * State-changing routes need the session cookie (HttpOnly, SameSite=Lax) and
 * the `X-Naoeumfa-Client: web` header, which a cross-site form cannot send
 * without a CORS preflight this server never grants (CSRF defence).
 */

import { IncomingMessage, ServerResponse } from 'node:http';
import { normalizeInstagramHandle } from '../../core/antiFraud.js';
import { LotAdError, validateLotAd } from '../../core/lotAd.js';
import { AuthLinkDto, MeDto } from '../../shared/apiContract.js';
import { AuthService, LOGIN_TOKEN_PATTERN, SESSION_TTL_MS } from '../auth/authService.js';
import { CityService } from '../cityService.js';
import { AppConfig } from '../config.js';
import { OfferService } from '../market/offerService.js';
import { cookie, header, HttpError, parseCookies, readAmount, readJsonObject, sendJson } from './httpKit.js';

export interface WalletContext {
  readonly config: AppConfig;
  readonly city: CityService;
  readonly auth: AuthService;
  readonly offers: OfferService;
}

const SESSION_COOKIE = 'nefa_session';

function readLinkToken(body: Record<string, unknown>): string {
  const token = typeof body.token === 'string' ? body.token : '';
  if (!LOGIN_TOKEN_PATTERN.test(token)) {
    throw new HttpError(400, 'INVALID_LINK', 'Malformed login link.');
  }
  return token;
}
const LISTING_CANCEL_ROUTE = /^\/api\/v1\/me\/listings\/(lst_[0-9a-z_]{1,40})\/cancel$/;
const OFFER_ROUTE = /^\/api\/v1\/properties\/(\d{1,10})\/offers$/;
const OFFER_DECISION_ROUTE = /^\/api\/v1\/me\/offers\/(off_[0-9a-f]{16})\/(accept|decline|withdraw)$/;
const LOT_AD_ROUTE = /^\/api\/v1\/me\/lots\/(\d{1,10})\/ad$/;

/** CSRF: the app's own header, and no foreign Origin outside the demo's dev proxy. */
export function requireAppClient(config: AppConfig, req: IncomingMessage): void {
  if (header(req, 'x-naoeumfa-client') !== 'web') {
    throw new HttpError(403, 'FORBIDDEN', 'Requests must come from the Não É Um Fã app.');
  }
  const origin = header(req, 'origin');
  const host = header(req, 'x-forwarded-host') ?? header(req, 'host');
  if (!config.demo && origin && host && new URL(origin).host !== host) {
    throw new HttpError(403, 'FORBIDDEN', 'Cross-site request refused.');
  }
}

export function sessionHandle(auth: AuthService, req: IncomingMessage): string | null {
  return auth.sessionHandle(parseCookies(req).get(SESSION_COOKIE));
}

export function requireSession(auth: AuthService, req: IncomingMessage): string {
  const handle = sessionHandle(auth, req);
  if (!handle) {
    throw new HttpError(401, 'NOT_CONNECTED', 'Connect your Instagram first.');
  }
  return handle;
}

function me(ctx: WalletContext, handle: string): MeDto {
  return { ...ctx.city.me(handle), offersReceived: ctx.offers.received(handle), offersMade: ctx.offers.made(handle) };
}

/** Returns true when the route was handled here. */
export async function handleWalletRoute(ctx: WalletContext, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const { config, city, auth, offers } = ctx;
  const route = `${req.method ?? 'GET'} ${url.pathname}`;

  switch (route) {
    case 'POST /api/v1/auth/link/peek': {
      requireAppClient(config, req);
      const handle = auth.peekLoginLink(readLinkToken(await readJsonObject(req)));
      if (!handle) {
        throw new HttpError(404, 'LINK_INVALID', 'This link expired or was already used. Ask for a new one in Direct.');
      }
      const dto: AuthLinkDto = { handle };
      sendJson(res, 200, dto);
      return true;
    }

    case 'POST /api/v1/auth/link/redeem': {
      requireAppClient(config, req);
      const result = auth.redeemLoginLink(readLinkToken(await readJsonObject(req)));
      if (!result) {
        throw new HttpError(404, 'LINK_INVALID', 'This link expired or was already used. Ask for a new one in Direct.');
      }
      res.setHeader('Set-Cookie', cookie(req, SESSION_COOKIE, result.sessionToken, SESSION_TTL_MS / 1000));
      const dto: AuthLinkDto = { handle: result.handle };
      sendJson(res, 200, dto);
      return true;
    }

    case 'POST /api/v1/auth/logout': {
      requireAppClient(config, req);
      auth.revoke(parseCookies(req).get(SESSION_COOKIE));
      res.setHeader('Set-Cookie', cookie(req, SESSION_COOKIE, '', 0));
      sendJson(res, 200, { ok: true });
      return true;
    }

    case 'POST /api/v1/dev/auth/link': {
      if (!config.sandbox) {
        throw new HttpError(404, 'NOT_FOUND', 'Route not found.');
      }
      requireAppClient(config, req);
      const body = await readJsonObject(req);
      const handle = typeof body.handle === 'string' ? normalizeInstagramHandle(body.handle) : null;
      if (!handle) {
        throw new HttpError(400, 'INVALID_HANDLE', 'Enter a valid Instagram @handle.');
      }
      // Demo stands in for Direct; the browser then goes through the same peek → redeem.
      sendJson(res, 201, { token: auth.createLoginLink(handle, `sandbox_${handle}`) });
      return true;
    }

    case 'GET /api/v1/me': {
      const handle = requireSession(auth, req);
      sendJson(res, 200, me(ctx, handle));
      return true;
    }

    case 'POST /api/v1/me/listings': {
      requireAppClient(config, req);
      const handle = requireSession(auth, req);
      const body = await readJsonObject(req);
      const plotIndex = typeof body.plotIndex === 'number' && Number.isInteger(body.plotIndex) ? body.plotIndex : -1;
      if (city.ownerOf(plotIndex) !== handle) {
        throw new HttpError(403, 'NOT_OWNER', 'You can only list a property you own.');
      }
      const listing = city.listProperty(handle, plotIndex, readAmount(body.priceBrlCents, 'priceBrlCents'));
      sendJson(res, 201, { listingId: listing.listingId });
      return true;
    }

    case 'POST /api/v1/me/transfers': {
      requireAppClient(config, req);
      const handle = requireSession(auth, req);
      const body = await readJsonObject(req);
      const to = typeof body.toHandle === 'string' ? normalizeInstagramHandle(body.toHandle) : null;
      if (!to) {
        throw new HttpError(400, 'INVALID_HANDLE', 'Send to a valid Instagram @handle.');
      }
      const transfer = city.transferTokens(handle, to, readAmount(body.amountMicro, 'amountMicro'));
      sendJson(res, 201, { transferId: transfer.transferId });
      return true;
    }

    default:
      break;
  }

  const cancel = req.method === 'POST' ? LISTING_CANCEL_ROUTE.exec(url.pathname) : null;
  if (cancel) {
    requireAppClient(config, req);
    city.cancelListing(cancel[1], requireSession(auth, req));
    sendJson(res, 200, { ok: true });
    return true;
  }

  const offer = req.method === 'POST' ? OFFER_ROUTE.exec(url.pathname) : null;
  if (offer) {
    requireAppClient(config, req);
    const handle = requireSession(auth, req);
    const plotIndex = Number.parseInt(offer[1], 10);
    const owner = city.ownerOf(plotIndex);
    if (!owner) {
      throw new HttpError(404, 'NOT_FOUND', 'No such property.');
    }
    const body = await readJsonObject(req);
    sendJson(res, 201, offers.make({ plotIndex, fromHandle: handle, toHandle: owner, amountBrlCents: readAmount(body.amountBrlCents, 'amountBrlCents') }));
    return true;
  }

  const lotAd = LOT_AD_ROUTE.exec(url.pathname);
  if (lotAd && (req.method === 'POST' || req.method === 'DELETE')) {
    requireAppClient(config, req);
    const handle = requireSession(auth, req);
    const plotIndex = Number.parseInt(lotAd[1], 10);
    try {
      if (req.method === 'DELETE') {
        sendJson(res, 200, { ok: true, lotAd: city.setLotAd(handle, plotIndex, null) });
        return true;
      }
      const body = await readJsonObject(req);
      sendJson(res, 200, { ok: true, lotAd: city.setLotAd(handle, plotIndex, validateLotAd(body)) });
      return true;
    } catch (err) {
      if (err instanceof LotAdError) {
        throw new HttpError(err.code === 'NOT_OWNER' ? 403 : err.code === 'NO_SUCH_PLOT' ? 404 : 400, err.code, err.message);
      }
      throw err;
    }
  }

  const decision = req.method === 'POST' ? OFFER_DECISION_ROUTE.exec(url.pathname) : null;
  if (decision) {
    requireAppClient(config, req);
    const handle = requireSession(auth, req);
    const [, id, action] = decision;
    if (action === 'withdraw') {
      sendJson(res, 200, offers.withdraw(id, handle));
      return true;
    }
    if (action === 'decline') {
      sendJson(res, 200, offers.decide(id, handle, 'DECLINED'));
      return true;
    }
    const accepted = offers.decide(id, handle, 'ACCEPTED');
    if (city.ownerOf(accepted.plotIndex) !== handle) {
      offers.reopen(id);
      throw new HttpError(409, 'NOT_OWNER', 'You no longer own this property.');
    }
    try {
      // Accepting lists the property at the offered price; the bidder buys it through the normal checkout.
      const listing = city.listProperty(handle, accepted.plotIndex, BigInt(accepted.amountBrlCents));
      offers.attachListing(id, listing.listingId);
      sendJson(res, 200, { ...accepted, listingId: listing.listingId });
    } catch (err) {
      offers.reopen(id);
      throw err;
    }
    return true;
  }

  return false;
}
