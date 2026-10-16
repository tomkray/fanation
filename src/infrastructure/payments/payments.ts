/**
 * Payment boundary: builds what the buyer pays (PIX BR Code or a crypto
 * address) and turns a signed provider callback into a `SettlementProof`.
 * Each PSP (Efí, Mercado Pago, Asaas…) has its own callback format; an
 * adapter for it must end in `parsePaymentCallback`'s shape.
 */

import { MarketListing, PaymentMethod } from '../../core/types.js';
import { priceForMethod, SettlementProof } from '../../core/marketplace.js';
import { buildPixBrCode } from '../../core/pix.js';
import { normalizeInstagramHandle } from '../../core/antiFraud.js';
import { CheckoutResponseDto } from '../../shared/apiContract.js';
import { AppConfig, DEMO_PIX_EVP_KEY } from '../config.js';

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['PIX', 'USDT', 'USDC', 'BTC'];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

export function paymentRailsStatus(config: AppConfig): Record<PaymentMethod, boolean> {
  return {
    PIX: config.payments.pixKey !== null || config.sandbox,
    USDT: config.payments.cryptoRails.USDT !== undefined,
    USDC: config.payments.cryptoRails.USDC !== undefined,
    BTC: config.payments.cryptoRails.BTC !== undefined,
  };
}

export class PaymentRailUnavailableError extends Error {
  constructor(readonly method: PaymentMethod) {
    super(`Payment rail ${method} is not configured on this server.`);
    this.name = 'PaymentRailUnavailableError';
  }
}

export function buildCheckoutInstructions(
  config: AppConfig,
  listing: MarketListing,
  method: PaymentMethod,
  checkoutRef: string,
  expiresAtMs: number
): CheckoutResponseDto {
  const amount = priceForMethod(listing, method);
  const base = {
    listingId: listing.listingId,
    paymentMethod: method,
    amountInteger: amount.toString(),
    expiresAtIso: new Date(expiresAtMs).toISOString(),
  };

  if (method === 'PIX') {
    const pixKey = config.payments.pixKey ?? DEMO_PIX_EVP_KEY;
    return {
      ...base,
      pix: {
        copiaECola: buildPixBrCode({
          pixKey,
          amountBrlCents: amount,
          merchantName: config.payments.pixMerchantName,
          merchantCity: config.payments.pixMerchantCity,
          txid: checkoutRef,
        }),
        demoKey: config.payments.pixKey === null,
      },
      crypto: null,
    };
  }

  const rail = config.payments.cryptoRails[method];
  if (!rail) {
    throw new PaymentRailUnavailableError(method);
  }
  return { ...base, pix: null, crypto: { network: rail.network, address: rail.address, memo: checkoutRef } };
}

export class PaymentCallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentCallbackError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strict shape check: anything unexpected is refused, never coerced. */
export function parsePaymentCallback(body: unknown, nowIso: string): SettlementProof {
  if (!isRecord(body)) {
    throw new PaymentCallbackError('Body must be a JSON object.');
  }
  const { listingId, buyerHandle, paymentMethod, paidAmountInteger, externalTxRef } = body;
  if (typeof listingId !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(listingId)) {
    throw new PaymentCallbackError('Invalid listingId.');
  }
  const buyer = typeof buyerHandle === 'string' ? normalizeInstagramHandle(buyerHandle) : null;
  if (!buyer) {
    throw new PaymentCallbackError('Invalid buyerHandle.');
  }
  if (!isPaymentMethod(paymentMethod)) {
    throw new PaymentCallbackError('Invalid paymentMethod.');
  }
  if (typeof paidAmountInteger !== 'string' || !/^\d{1,20}$/.test(paidAmountInteger)) {
    throw new PaymentCallbackError('paidAmountInteger must be a decimal integer string.');
  }
  if (typeof externalTxRef !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/.test(externalTxRef)) {
    throw new PaymentCallbackError('Invalid externalTxRef.');
  }
  return {
    listingId,
    buyerHandle: buyer,
    paymentMethod,
    paidAmountInteger: BigInt(paidAmountInteger),
    externalTxRef,
    settledAtIso: nowIso,
  };
}
