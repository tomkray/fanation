import type { AdCity, AdPlacement } from '../../core/ads.js';
import type { PaymentMethod } from '../../core/types.js';
import type {
  AdRequestReceiptDto,
  AdsDto,
  ApiErrorDto,
  AuthLinkDto,
  MeDto,
  OfferDto,
  CheckoutResponseDto,
  PropertyDetailDto,
  PublicConfigDto,
  WorldChangesDto,
  WorldChunksDto,
  WorldSummaryDto,
} from '../../shared/apiContract.js';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    // The server only accepts state changes carrying this header (CSRF defence; see walletRoutes).
    headers: { 'Content-Type': 'application/json', 'X-Naoeumfa-Client': 'web', ...(init?.headers ?? {}) },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const err = body as Partial<ApiErrorDto> | null;
    throw new ApiError(response.status, err?.code ?? 'HTTP_ERROR', err?.error ?? `HTTP ${response.status}`);
  }
  return body as T;
}

export interface AdRequestBody {
  readonly placement: AdPlacement;
  readonly city: AdCity;
  readonly days: number;
  readonly contactEmail: string;
  readonly creative: {
    readonly headline: string;
    readonly tagline: string;
    readonly partnerHandle: string;
    readonly backgroundHex: string;
    readonly accentHex: string;
  };
}

/** Instagram handles are already validated server-side; this only keeps the URL well-formed. */
const HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/;

export const api = {
  config: () => request<PublicConfigDto>('/api/v1/config'),
  world: () => request<WorldSummaryDto>('/api/v1/world'),
  chunks: (keys: readonly string[]) => request<WorldChunksDto>(`/api/v1/world/chunks?keys=${encodeURIComponent(keys.join(','))}`),
  changes: (since: number) => request<WorldChangesDto>(`/api/v1/world/changes?since=${since}`),
  property: (plotIndex: number) => request<PropertyDetailDto>(`/api/v1/properties/${plotIndex}`),
  profile: (handle: string) => request<PropertyDetailDto>(`/api/v1/profiles/${encodeURIComponent(handle)}`),
  /** Buys for the connected profile; the server takes the buyer from the session. */
  checkout: (listingId: string, paymentMethod: PaymentMethod) =>
    request<CheckoutResponseDto>('/api/v1/market/checkout', {
      method: 'POST',
      body: JSON.stringify({ listingId, paymentMethod }),
    }),
  authLinkPeek: (token: string) => request<AuthLinkDto>('/api/v1/auth/link/peek', { method: 'POST', body: JSON.stringify({ token }) }),
  authLinkRedeem: (token: string) => request<AuthLinkDto>('/api/v1/auth/link/redeem', { method: 'POST', body: JSON.stringify({ token }) }),
  devAuthLink: (handle: string) => request<{ token: string }>('/api/v1/dev/auth/link', { method: 'POST', body: JSON.stringify({ handle }) }),
  logout: () => request<{ ok: boolean }>('/api/v1/auth/logout', { method: 'POST', body: '{}' }),
  me: () => request<MeDto>('/api/v1/me'),
  listProperty: (plotIndex: number, priceBrlCents: string) =>
    request<{ listingId: string }>('/api/v1/me/listings', { method: 'POST', body: JSON.stringify({ plotIndex, priceBrlCents }) }),
  cancelListing: (listingId: string) => request<{ ok: boolean }>(`/api/v1/me/listings/${encodeURIComponent(listingId)}/cancel`, { method: 'POST', body: '{}' }),
  transfer: (toHandle: string, amountMicro: string) =>
    request<{ transferId: string }>('/api/v1/me/transfers', { method: 'POST', body: JSON.stringify({ toHandle, amountMicro }) }),
  makeOffer: (plotIndex: number, amountBrlCents: string) =>
    request<OfferDto>(`/api/v1/properties/${plotIndex}/offers`, { method: 'POST', body: JSON.stringify({ amountBrlCents }) }),
  decideOffer: (offerId: string, action: 'accept' | 'decline' | 'withdraw') =>
    request<OfferDto>(`/api/v1/me/offers/${encodeURIComponent(offerId)}/${action}`, { method: 'POST', body: '{}' }),
  setLotAd: (plotIndex: number, creative: { readonly headline: string; readonly tagline: string; readonly backgroundHex: string; readonly accentHex: string }) =>
    request<{ ok: boolean }>(`/api/v1/me/lots/${plotIndex}/ad`, { method: 'POST', body: JSON.stringify(creative) }),
  transferBadge: (idolHandle: string, toHandle: string) =>
    request<{ holderHandle: string }>(`/api/v1/me/badges/${encodeURIComponent(idolHandle)}/transfer`, { method: 'POST', body: JSON.stringify({ toHandle }) }),
  listBadge: (idolHandle: string, priceBrlCents: string) =>
    request<{ listingId: string }>(`/api/v1/me/badges/${encodeURIComponent(idolHandle)}/list`, { method: 'POST', body: JSON.stringify({ priceBrlCents }) }),
  clearLotAd: (plotIndex: number) => request<{ ok: boolean }>(`/api/v1/me/lots/${plotIndex}/ad`, { method: 'DELETE' }),
  ads: () => request<AdsDto>('/api/v1/ads'),
  requestAd: (body: AdRequestBody) =>
    request<AdRequestReceiptDto>('/api/v1/ads/requests', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  simulatePayment: (listingId: string) =>
    request<Record<string, unknown>>('/api/v1/dev/simulate-payment', {
      method: 'POST',
      body: JSON.stringify({ listingId }),
    }),
};

/** "12.50" / "12,50" / "12" → integer cents as a string; null when it is not a money amount. */
export function centsFromInput(raw: string): string | null {
  const match = /^\s*(\d{1,12})(?:[.,](\d{1,2}))?\s*$/.exec(raw);
  if (!match) {
    return null;
  }
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '0').padEnd(2, '0'));
  return cents > 0n ? cents.toString() : null;
}

/** "25" / "2.5" $NEFA → integer micro-units as a string. */
export function microFromInput(raw: string): string | null {
  const match = /^\s*(\d{1,12})(?:[.,](\d{1,6}))?\s*$/.exec(raw);
  if (!match) {
    return null;
  }
  const micro = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? '0').padEnd(6, '0'));
  return micro > 0n ? micro.toString() : null;
}

export function avatarUrl(handle: string): string | null {
  return HANDLE_PATTERN.test(handle) ? `/api/v1/avatars/${handle}` : null;
}

export type StreamStatus = 'connecting' | 'live' | 'reconnecting';

/** `EventSource` reconnects by itself; we only surface its state. */
export function subscribeWorldStream(onVersion: (version: number) => void, onStatus: (status: StreamStatus) => void): () => void {
  const source = new EventSource('/api/v1/stream');
  onStatus('connecting');
  source.addEventListener('open', () => onStatus('live'));
  source.addEventListener('error', () => onStatus('reconnecting'));
  source.addEventListener('city', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as { version?: unknown };
      if (typeof data.version === 'number') {
        onVersion(data.version);
      }
    } catch {
      onStatus('reconnecting');
    }
  });
  return () => source.close();
}
