/**
 * P2P marketplace rules (`naoeumfa/market`). Pure functions over
 * listings; the ledger applies their results. Axiom A5: integers only.
 */

import { LandPlot, ListingAssetType, MarketListing, PaymentMethod } from './types.js';

export const MARKETPLACE_FEE_BPS = 250n;
export const BPS_DENOMINATOR = 10_000n;
export const CHECKOUT_LOCK_TTL_MS = 15 * 60_000;

export type MarketErrorCode =
  | 'SELLER_NOT_OWNER'
  | 'INVALID_PRICE'
  | 'INVALID_ASSET'
  | 'INSUFFICIENT_BALANCE'
  | 'ALREADY_LISTED'
  | 'LISTING_NOT_FOUND'
  | 'LISTING_UNAVAILABLE'
  | 'LISTING_LOCKED'
  | 'WASH_TRADE'
  | 'LOCK_MISMATCH'
  | 'UNDERPAID'
  | 'INVALID_TX_REF';

export class MarketError extends Error {
  constructor(readonly code: MarketErrorCode, message: string) {
    super(message);
    this.name = 'MarketError';
  }
}

export interface CreateListingInput {
  readonly listingId: string;
  readonly sellerHandle: string;
  readonly assetType: ListingAssetType;
  readonly plotIndex: number | null;
  readonly tokenAmountMicro: bigint | null;
  /** FOUNDER_BADGE only: the idol whose captain tag is sold. Absent in records written before tags. */
  readonly badgeIdol?: string | null;
  readonly priceBrlCents: bigint;
  readonly priceUsdtMicro: bigint;
  readonly priceBtcSats: bigint;
  readonly nowIso: string;
}

export interface ListingContext {
  /** The land at `plotIndex`, if any. */
  readonly land: LandPlot | undefined;
  readonly sellerBalanceMicro: bigint;
  readonly plotAlreadyListed: boolean;
  /** Who holds the captain tag of `badgeIdol` (undefined when there is no such tag). */
  readonly badgeHolder?: string;
  readonly badgeAlreadyListed?: boolean;
}

export interface CheckoutRequest {
  readonly listingId: string;
  readonly buyerHandle: string;
  readonly paymentMethod: PaymentMethod;
  readonly checkoutRef: string;
  readonly nowMs: number;
}

export interface SettlementProof {
  readonly listingId: string;
  readonly buyerHandle: string;
  readonly paymentMethod: PaymentMethod;
  readonly paidAmountInteger: bigint;
  readonly externalTxRef: string;
  readonly settledAtIso: string;
}

export interface SettlementReceipt {
  readonly listing: MarketListing;
  readonly requiredAmountInteger: bigint;
  readonly platformFeeInteger: bigint;
  readonly sellerNetPayoutInteger: bigint;
  /** Paid above the price; owed back to the buyer, never to the seller. */
  readonly excessToRefundInteger: bigint;
  readonly paymentMethod: PaymentMethod;
}

export function calculateFeeSplit(grossAmount: bigint): { readonly fee: bigint; readonly sellerNet: bigint } {
  if (grossAmount <= 0n) {
    throw new RangeError('grossAmount must be a positive integer.');
  }
  const fee = (grossAmount * MARKETPLACE_FEE_BPS) / BPS_DENOMINATOR;
  return { fee, sellerNet: grossAmount - fee };
}

export function priceForMethod(listing: MarketListing, method: PaymentMethod): bigint {
  switch (method) {
    case 'PIX':
      return listing.priceBrlCents;
    case 'USDT':
    case 'USDC':
      return listing.priceUsdtMicro;
    case 'BTC':
      return listing.priceBtcSats;
    default: {
      const exhaustive: never = method;
      throw new Error(`Unsupported payment method: ${String(exhaustive)}`);
    }
  }
}

export function createMarketListing(input: CreateListingInput, ctx: ListingContext): MarketListing {
  if (input.priceBrlCents <= 0n || input.priceUsdtMicro <= 0n || input.priceBtcSats <= 0n) {
    throw new MarketError('INVALID_PRICE', 'All prices must be positive integers.');
  }

  switch (input.assetType) {
    case 'LAND_PLOT':
      if (input.plotIndex === null || !ctx.land || ctx.land.plotIndex !== input.plotIndex) {
        throw new MarketError('INVALID_ASSET', 'LAND_PLOT listing needs an existing plotIndex.');
      }
      if (ctx.land.ownerHandle !== input.sellerHandle) {
        throw new MarketError('SELLER_NOT_OWNER', `@${input.sellerHandle} does not own plot #${input.plotIndex}.`);
      }
      if (ctx.plotAlreadyListed) {
        throw new MarketError('ALREADY_LISTED', `Plot #${input.plotIndex} already has an active listing.`);
      }
      break;
    case 'NEFA_PACK':
      if (input.tokenAmountMicro === null || input.tokenAmountMicro <= 0n) {
        throw new MarketError('INVALID_ASSET', 'tokenAmountMicro must be positive.');
      }
      if (ctx.sellerBalanceMicro < input.tokenAmountMicro) {
        throw new MarketError('INSUFFICIENT_BALANCE', 'Insufficient $NEFA balance to escrow the pack.');
      }
      break;
    case 'FOUNDER_BADGE':
      if (!input.badgeIdol || ctx.badgeHolder === undefined) {
        throw new MarketError('INVALID_ASSET', 'FOUNDER_BADGE listing needs an existing captain tag.');
      }
      if (ctx.badgeHolder !== input.sellerHandle) {
        throw new MarketError('SELLER_NOT_OWNER', `@${input.sellerHandle} does not hold the captain tag of @${input.badgeIdol}.`);
      }
      if (ctx.badgeAlreadyListed) {
        throw new MarketError('ALREADY_LISTED', `The captain tag of @${input.badgeIdol} is already for sale.`);
      }
      break;
    default: {
      const exhaustive: never = input.assetType;
      throw new MarketError('INVALID_ASSET', `Unsupported assetType: ${String(exhaustive)}`);
    }
  }

  return {
    listingId: input.listingId,
    sellerHandle: input.sellerHandle,
    assetType: input.assetType,
    plotIndex: input.assetType === 'LAND_PLOT' ? input.plotIndex : null,
    tokenAmountMicro: input.assetType === 'NEFA_PACK' ? input.tokenAmountMicro : null,
    badgeIdol: input.assetType === 'FOUNDER_BADGE' ? input.badgeIdol ?? null : null,
    priceBrlCents: input.priceBrlCents,
    priceUsdtMicro: input.priceUsdtMicro,
    priceBtcSats: input.priceBtcSats,
    status: 'OPEN',
    lock: null,
    buyerHandle: null,
    paymentMethod: null,
    externalTxRef: null,
    createdAtIso: input.nowIso,
    settledAtIso: null,
  };
}

/**
 * Reserves the listing for one buyer while they pay, so two buyers can never
 * pay for the same plot. An expired lock can be taken over by another buyer.
 */
export function lockListingForCheckout(listing: MarketListing, request: CheckoutRequest): MarketListing {
  if (listing.status === 'SETTLED' || listing.status === 'CANCELLED') {
    throw new MarketError('LISTING_UNAVAILABLE', `Listing ${listing.listingId} is ${listing.status}.`);
  }
  if (request.buyerHandle === listing.sellerHandle) {
    throw new MarketError('WASH_TRADE', 'Buyer cannot be the seller.');
  }
  if (
    listing.status === 'LOCKED_ESCROW' &&
    listing.lock !== null &&
    listing.lock.expiresAtMs > request.nowMs &&
    listing.lock.buyerHandle !== request.buyerHandle
  ) {
    throw new MarketError('LISTING_LOCKED', 'Another buyer is paying for this listing right now.');
  }

  return {
    ...listing,
    status: 'LOCKED_ESCROW',
    lock: {
      buyerHandle: request.buyerHandle,
      paymentMethod: request.paymentMethod,
      checkoutRef: request.checkoutRef,
      lockedAtMs: request.nowMs,
      expiresAtMs: request.nowMs + CHECKOUT_LOCK_TTL_MS,
    },
  };
}

/**
 * Settles against the current lock. A payment that lands after expiry is still
 * honoured as long as no other buyer took the lock over in between.
 */
export function settleMarketListing(listing: MarketListing, proof: SettlementProof): SettlementReceipt {
  if (listing.status !== 'LOCKED_ESCROW' || listing.lock === null) {
    throw new MarketError('LISTING_UNAVAILABLE', `Listing ${listing.listingId} has no active checkout.`);
  }
  if (listing.lock.buyerHandle !== proof.buyerHandle || listing.lock.paymentMethod !== proof.paymentMethod) {
    throw new MarketError('LOCK_MISMATCH', 'Payment does not match the active checkout (buyer or method).');
  }
  const ref = proof.externalTxRef.trim();
  if (ref.length < 8 || ref.length > 128) {
    throw new MarketError('INVALID_TX_REF', 'Invalid external transaction reference.');
  }

  const required = priceForMethod(listing, proof.paymentMethod);
  if (proof.paidAmountInteger < required) {
    throw new MarketError(
      'UNDERPAID',
      `Underpaid ${proof.paymentMethod}: expected ${required}, received ${proof.paidAmountInteger}.`
    );
  }

  const { fee, sellerNet } = calculateFeeSplit(required);
  return {
    listing: {
      ...listing,
      status: 'SETTLED',
      lock: null,
      buyerHandle: proof.buyerHandle,
      paymentMethod: proof.paymentMethod,
      externalTxRef: ref,
      settledAtIso: proof.settledAtIso,
    },
    requiredAmountInteger: required,
    platformFeeInteger: fee,
    sellerNetPayoutInteger: sellerNet,
    excessToRefundInteger: proof.paidAmountInteger - required,
    paymentMethod: proof.paymentMethod,
  };
}
