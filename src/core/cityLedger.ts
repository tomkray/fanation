/**
 * The city ledger: the only place state changes. Every change is a
 * `LedgerEvent`, so replaying a journal rebuilds identical state.
 *
 * The rule is the same for everyone (Axiom A1): one mint per @, forever.
 * Naming an idol builds that one home. Ownership is a bank — a profile may
 * hold many deeds bought on the market. Reputation (XP) stays with the @.
 */

import { consumeHandleRateLimit, normalizeInstagramHandle, parseAndValidateComment } from './antiFraud.js';
import { computeChampionshipStandings } from './championship.js';
import { cityForCategory } from './cities.js';
import { cellToMeters, CityLayout, createCityLayout, placeHomeNear, placeIdolAnchor } from './cityLayout.js';
import { resolveFandomMetadata } from './fandomRegistry.js';
import {
  CheckoutRequest,
  createMarketListing,
  CreateListingInput,
  lockListingForCheckout,
  MarketError,
  settleMarketListing,
  SettlementProof,
  SettlementReceipt,
} from './marketplace.js';
import { PropertyClass, propertyClassFor, PropertyFootprint } from './property.js';
import { ENGAGEMENT_XP, levelForXp, MINT_XP } from './reputation.js';
import { settleLayout } from './settle.js';
import { distributeByWeight, SEASON_FANS_BPS, seasonPrizeMicro, splitPack } from './tokenomics.js';
import { LotAd, LotAdError, validateLotAd } from './lotAd.js';
import { CommentProcessingOutcome, FandomClubStats, InstagramCommentEvent, LandPlot, MarketListing } from './types.js';
import type { CityId } from './cities.js';

export interface CityLedgerConfig {
  /** Comments from the official account (replies, pinned CTAs) never mint. */
  readonly officialAccountHandle: string | null;
  /**
   * Comment-time length of a layout epoch; the first comment of each new epoch
   * reorganizes the map (A3). Null keeps positions where they were first placed.
   * Part of the replay contract: the same journal with the same epoch gives the same map.
   */
  readonly layoutEpochMs: number | null;
  /** Comment-time length of a $NEFA season (A11); null disables season payouts. Part of the replay contract. */
  readonly seasonLengthMs: number | null;
}

export const DEFAULT_LEDGER_CONFIG: CityLedgerConfig = { officialAccountHandle: null, layoutEpochMs: null, seasonLengthMs: null };

/** +1 XP for each friend a member tags, once per friend, at most this many new friends per day (A11). */
export const FRIEND_TAG_XP = 1;
export const FRIEND_TAGS_PER_DAY = 20;

export interface SeasonResult {
  readonly season: number;
  readonly prizeMicro: bigint;
  readonly paidMicro: bigint;
  readonly top: readonly { readonly handle: string; readonly micro: bigint }[];
}

/** Where every $NEFA came from; locked buckets are never minted by the game. */
export interface TokenomicsState {
  fanMintedMicro: bigint;
  /** Packs issued so far; the next newcomer is member number `members`. */
  members: number;
  idolRoyaltiesMicro: bigint;
  seasonPaidMicro: bigint;
  season: number;
  /** The planet's first season (comment-time index), so seasons can be numbered 1, 2, 3… */
  firstSeason: number;
  readonly seasonXp: Map<string, number>;
  readonly seasonFandomXp: Map<string, number>;
  lastSeason: SeasonResult | null;
}

/** A $NEFA transfer between two verified profiles (A5: integer micro-units). */
export interface TokenTransfer {
  readonly transferId: string;
  readonly fromHandle: string;
  readonly toHandle: string;
  readonly amountMicro: bigint;
  readonly atIso: string;
}

export type OfferStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN';

/**
 * A bid on someone's property. No money moves with an offer: accepting it
 * lists the property at the offered price in the same event, and the bidder
 * pays through the normal escrowed checkout (A5).
 */
export interface PropertyOffer {
  readonly offerId: string;
  readonly plotIndex: number;
  readonly fromHandle: string;
  /** The owner when it was made. Only that owner, still holding the deed, can accept it. */
  readonly toHandle: string;
  readonly amountBrlCents: bigint;
  readonly status: OfferStatus;
  readonly createdAtIso: string;
  /** Set when an accepted offer became a listing the bidder can buy. */
  readonly listingId: string | null;
}

export interface OfferInput {
  readonly offerId: string;
  readonly plotIndex: number;
  readonly fromHandle: string;
  readonly amountBrlCents: bigint;
  readonly atIso: string;
}

export const MIN_OFFER_BRL_CENTS = 100n;
export const MAX_OFFER_BRL_CENTS = 100_000_000_000n;
export const MAX_PENDING_OFFERS_PER_BIDDER = 20;
export const MAX_PENDING_OFFERS = 5_000;

export type OfferErrorCode =
  | 'NO_SUCH_PLOT'
  | 'OWN_PROPERTY'
  | 'INVALID_AMOUNT'
  | 'TOO_MANY_OFFERS'
  | 'DUPLICATE_OFFER'
  | 'NO_SUCH_OFFER'
  | 'OFFER_CLOSED'
  | 'NOT_BIDDER'
  | 'NOT_OWNER'
  | 'OFFER_MISMATCH';

export class OfferError extends Error {
  constructor(
    readonly code: OfferErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'OfferError';
  }
}

/**
 * The official account runs the game; it never plays it. It gets no home, no
 * XP, no $NEFA, no listing, bid, purchase or ad, and is never anyone's idol.
 */
export class OfficialAccountError extends Error {
  constructor(handle: string) {
    super(`@${handle} is the official account and never takes part in the game.`);
    this.name = 'OfficialAccountError';
  }
}

function assertPlayer(state: CityState, handle: string): void {
  const official = state.config.officialAccountHandle;
  if (official !== null && handle.trim().toLowerCase().replace(/^@/, '') === official) {
    throw new OfficialAccountError(official);
  }
}

export type LedgerEvent =
  | { readonly kind: 'comment'; readonly event: InstagramCommentEvent }
  | { readonly kind: 'listing_created'; readonly input: CreateListingInput }
  | { readonly kind: 'listing_cancelled'; readonly listingId: string; readonly sellerHandle: string }
  | { readonly kind: 'checkout_locked'; readonly request: CheckoutRequest }
  | { readonly kind: 'payment_settled'; readonly proof: SettlementProof }
  | { readonly kind: 'token_transferred'; readonly transfer: TokenTransfer }
  | { readonly kind: 'lot_ad_set'; readonly plotIndex: number; readonly ownerHandle: string; readonly creative: LotAd | null }
  | { readonly kind: 'offer_made'; readonly offer: OfferInput }
  | { readonly kind: 'offer_withdrawn'; readonly offerId: string; readonly bidderHandle: string }
  | { readonly kind: 'offer_declined'; readonly offerId: string; readonly ownerHandle: string }
  | { readonly kind: 'offer_accepted'; readonly offerId: string; readonly ownerHandle: string; readonly listing: CreateListingInput };

export type LedgerEventResult =
  | { readonly kind: 'comment'; readonly outcome: CommentProcessingOutcome }
  | { readonly kind: 'listing_created'; readonly listing: MarketListing }
  | { readonly kind: 'listing_cancelled'; readonly listing: MarketListing }
  | { readonly kind: 'checkout_locked'; readonly listing: MarketListing }
  | { readonly kind: 'payment_settled'; readonly receipt: SettlementReceipt }
  | { readonly kind: 'token_transferred'; readonly transfer: TokenTransfer }
  | { readonly kind: 'lot_ad_set'; readonly plotIndex: number; readonly ad: LotAd | null }
  | { readonly kind: 'offer_made'; readonly offer: PropertyOffer }
  | { readonly kind: 'offer_closed'; readonly offer: PropertyOffer }
  | { readonly kind: 'offer_accepted'; readonly offer: PropertyOffer; readonly listing: MarketListing };

export interface CityState {
  readonly config: CityLedgerConfig;
  /** Index = plotIndex. */
  readonly lands: LandPlot[];
  /** Axiom A1 mint key: handle → the one home they were given. Never deleted, never reassigned. */
  readonly plotIndexByMinter: Map<string, number>;
  /** Deeds each @ currently holds (minted and still owned, plus every purchase). */
  readonly plotsByOwner: Map<string, Set<number>>;
  /** Billboard on a lot; wiped when the deed changes hands. */
  readonly lotAds: Map<number, LotAd>;
  readonly layout: CityLayout;
  readonly processedCommentIds: Set<string>;
  /** `${handle}:${mediaId}` — one counted comment per fan per post. */
  readonly countedPostKeys: Set<string>;
  readonly recentEventsByAuthor: Map<string, number[]>;
  /** Handles that have commented at least once (received their $NEFA grant). */
  readonly activeHandles: Set<string>;
  /** `${fan}>${idol}` — each fan counts once per idol. */
  readonly fanEdges: Set<string>;
  readonly fansByIdol: Map<string, number>;
  /** Reputation of each profile. Earned only; never listed, sold or transferred. */
  readonly reputationXpByHandle: Map<string, number>;
  /** Reputation fans earned for each idol. */
  readonly reputationXpByFandom: Map<string, number>;
  /** $NEFA, the tradable balance. */
  readonly tokenBalancesMicro: Map<string, bigint>;
  readonly listings: Map<string, MarketListing>;
  readonly offers: Map<string, PropertyOffer>;
  readonly settledTxRefs: Set<string>;
  /** Layout epochs (A3): which epoch the map belongs to and how many times it was rebuilt. */
  readonly layoutEpoch: { epoch: number; rebuilds: number; propertiesAtLastRebuild: number };
  /** Profile stats: counted comments, and how many idols each fan supports. */
  readonly countedCommentsByHandle: Map<string, number>;
  readonly idolsSupportedByHandle: Map<string, number>;
  readonly tokenomics: TokenomicsState;
  /** `${member}>${friend}`: each friend tag pays XP once, ever. */
  readonly friendTags: Set<string>;
  readonly friendTagsToday: Map<string, { day: number; count: number }>;
}

export interface FanProfile {
  readonly handle: string;
  readonly reputationXp: number;
  readonly level: number;
  readonly tokenBalanceMicro: bigint;
  /** People who named this handle as their idol. */
  readonly fans: number;
  readonly propertyClass: PropertyClass | null;
  /** The idol whose district they live in. */
  readonly fandomHandle: string | null;
}

export function createCityState(config: CityLedgerConfig = DEFAULT_LEDGER_CONFIG): CityState {
  return {
    config,
    lands: [],
    plotIndexByMinter: new Map(),
    plotsByOwner: new Map(),
    lotAds: new Map(),
    layout: createCityLayout(),
    processedCommentIds: new Set(),
    countedPostKeys: new Set(),
    recentEventsByAuthor: new Map(),
    activeHandles: new Set(),
    fanEdges: new Set(),
    fansByIdol: new Map(),
    reputationXpByHandle: new Map(),
    reputationXpByFandom: new Map(),
    tokenBalancesMicro: new Map(),
    listings: new Map(),
    offers: new Map(),
    settledTxRefs: new Set(),
    layoutEpoch: { epoch: Number.NEGATIVE_INFINITY, rebuilds: 0, propertiesAtLastRebuild: 0 },
    countedCommentsByHandle: new Map(),
    idolsSupportedByHandle: new Map(),
    tokenomics: {
      fanMintedMicro: 0n,
      members: 0,
      idolRoyaltiesMicro: 0n,
      seasonPaidMicro: 0n,
      season: Number.NEGATIVE_INFINITY,
      firstSeason: Number.NEGATIVE_INFINITY,
      seasonXp: new Map(),
      seasonFandomXp: new Map(),
      lastSeason: null,
    },
    friendTags: new Set(),
    friendTagsToday: new Map(),
  };
}

/** XP a profile earns; it also counts towards this season's $NEFA payout. */
function earnXp(state: CityState, handle: string, xp: number): void {
  addXp(state.reputationXpByHandle, handle, xp);
  addXp(state.tokenomics.seasonXp, handle, xp);
}

/** XP fans earn for their idol; it counts towards the idol's season payout. */
function earnFandomXp(state: CityState, idol: string, xp: number): void {
  addXp(state.reputationXpByFandom, idol, xp);
  addXp(state.tokenomics.seasonFandomXp, idol, xp);
}

/** Pays the season that just ended (A11) on the first comment of the next one. */
function advanceSeason(state: CityState, atMs: number): void {
  const length = state.config.seasonLengthMs;
  if (length === null) {
    return;
  }
  const season = Math.floor(atMs / length);
  const t = state.tokenomics;
  if (season <= t.season) {
    return;
  }
  if (Number.isFinite(t.season)) {
    const prize = seasonPrizeMicro(t.seasonPaidMicro);
    const fansPool = (prize * SEASON_FANS_BPS) / 10_000n;
    const fans = distributeByWeight(fansPool, t.seasonXp);
    const idols = distributeByWeight(prize - fansPool, t.seasonFandomXp);
    const credited = new Map<string, bigint>();
    for (const [handle, micro] of [...fans.payouts, ...idols.payouts]) {
      addTokens(state, handle, micro);
      credited.set(handle, (credited.get(handle) ?? 0n) + micro);
    }
    t.seasonPaidMicro += fans.paidMicro + idols.paidMicro;
    t.lastSeason = {
      season: t.season - t.firstSeason + 1,
      prizeMicro: prize,
      paidMicro: fans.paidMicro + idols.paidMicro,
      top: [...credited.entries()]
        .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : a[0].localeCompare(b[0])))
        .slice(0, 10)
        .map(([handle, micro]) => ({ handle, micro })),
    };
  }
  if (!Number.isFinite(t.firstSeason)) {
    t.firstSeason = season;
  }
  t.season = season;
  t.seasonXp.clear();
  t.seasonFandomXp.clear();
}

/** +1 XP per new friend tagged by an existing member: once per friend, capped per day. */
function rewardFriendTags(state: CityState, member: string, friends: readonly string[], atMs: number): number {
  const day = Math.floor(atMs / 86_400_000);
  const today = state.friendTagsToday.get(member);
  const counter = today && today.day === day ? today : { day, count: 0 };
  let xp = 0;
  for (const friend of friends) {
    const key = `${member}>${friend}`;
    if (counter.count >= FRIEND_TAGS_PER_DAY || state.friendTags.has(key)) {
      continue;
    }
    state.friendTags.add(key);
    counter.count += 1;
    xp += FRIEND_TAG_XP;
  }
  state.friendTagsToday.set(member, counter);
  if (xp > 0) {
    earnXp(state, member, xp);
  }
  return xp;
}

/** The first comment of a new epoch rebuilds the map, if anything was built since the last rebuild. */
function advanceLayoutEpoch(state: CityState, atMs: number): void {
  const every = state.config.layoutEpochMs;
  if (every === null) {
    return;
  }
  const epoch = Math.floor(atMs / every);
  const clock = state.layoutEpoch;
  if (epoch <= clock.epoch) {
    return;
  }
  clock.epoch = epoch;
  if (state.lands.length === clock.propertiesAtLastRebuild) {
    return;
  }
  settleLayout(state);
  clock.rebuilds += 1;
  clock.propertiesAtLastRebuild = state.lands.length;
}

function addXp(map: Map<string, number>, handle: string, xp: number): void {
  map.set(handle, (map.get(handle) ?? 0) + xp);
}

function addTokens(state: CityState, handle: string, amountMicro: bigint): void {
  const next = (state.tokenBalancesMicro.get(handle) ?? 0n) + amountMicro;
  if (next < 0n) {
    throw new MarketError('INSUFFICIENT_BALANCE', `Balance of @${handle} would go negative.`);
  }
  state.tokenBalancesMicro.set(handle, next);
}

function addProperty(
  state: CityState,
  input: {
    readonly handle: string;
    readonly fandomHandle: string;
    readonly idolHandle: string | null;
    readonly footprint: PropertyFootprint;
    readonly city: CityId;
    readonly cell: { readonly gridQ: number; readonly gridR: number };
    readonly commentId: string;
    readonly atMs: number;
  }
): LandPlot {
  const land: LandPlot = {
    plotIndex: state.lands.length,
    minterHandle: input.handle,
    ownerHandle: input.handle,
    fandomHandle: input.fandomHandle,
    idolHandle: input.idolHandle,
    footprint: input.footprint,
    city: input.city,
    coordinates: { ...input.cell, ...cellToMeters(input.cell.gridQ, input.cell.gridR) },
    sourceCommentId: input.commentId,
    mintedAtIso: new Date(input.atMs).toISOString(),
  };
  state.lands.push(land);
  state.plotIndexByMinter.set(input.handle, land.plotIndex);
  grantDeed(state, input.handle, land.plotIndex);
  return land;
}

function ownerSet(state: CityState, handle: string): Set<number> {
  let plots = state.plotsByOwner.get(handle);
  if (!plots) {
    plots = new Set();
    state.plotsByOwner.set(handle, plots);
  }
  return plots;
}

function grantDeed(state: CityState, handle: string, plotIndex: number): void {
  ownerSet(state, handle).add(plotIndex);
}

function revokeDeed(state: CityState, handle: string, plotIndex: number): void {
  state.plotsByOwner.get(handle)?.delete(plotIndex);
}

/** Deeds this @ holds right now, cheapest plot first. */
export function plotsOwnedBy(state: CityState, handle: string): number[] {
  return [...(state.plotsByOwner.get(handle) ?? [])].sort((a, b) => a - b);
}

export function homesOwnedBy(state: CityState, handle: string): number {
  return state.plotsByOwner.get(handle)?.size ?? 0;
}

/** A catalogued idol gets a landmark block in its category's city; anyone else one lot in Community City. */
function ensureIdolProperty(state: CityState, idol: string, commentId: string, atMs: number): LandPlot {
  const existing = state.plotIndexByMinter.get(idol);
  if (existing !== undefined) {
    return state.lands[existing];
  }
  const meta = resolveFandomMetadata(idol);
  const footprint: PropertyFootprint = meta.category === 'UNLISTED' ? 'LOT' : 'BLOCK';
  const city = cityForCategory(meta.category);
  return addProperty(state, {
    handle: idol,
    fandomHandle: idol,
    idolHandle: null,
    footprint,
    city,
    cell: placeIdolAnchor(state.layout, city, footprint, idol),
    commentId,
    atMs,
  });
}

/**
 * Order matters: dedupe → own account → rate limit → format → per-post →
 * make sure the idol has a property → move the fan in next to them (or award
 * XP if they already live somewhere) → count the fan for the idol.
 */
export function applyCommentEvent(state: CityState, event: InstagramCommentEvent): CommentProcessingOutcome {
  advanceSeason(state, event.receivedAtMs);
  advanceLayoutEpoch(state, event.receivedAtMs);
  if (state.processedCommentIds.has(event.commentId)) {
    return { status: 'REJECTED', code: 'DUPLICATE_COMMENT_ID', reason: `Comment ${event.commentId} already processed.` };
  }
  state.processedCommentIds.add(event.commentId);

  const official = state.config.officialAccountHandle;
  const author = normalizeInstagramHandle(event.authorUsername) ?? event.authorUsername.toLowerCase();
  if (official !== null && author === official) {
    return { status: 'REJECTED', code: 'OWN_ACCOUNT_COMMENT', reason: 'Comments by the official account never mint.' };
  }

  let timestamps = state.recentEventsByAuthor.get(author);
  if (!timestamps) {
    timestamps = [];
    state.recentEventsByAuthor.set(author, timestamps);
  }
  if (!consumeHandleRateLimit(timestamps, event.receivedAtMs)) {
    return { status: 'REJECTED', code: 'RATE_LIMIT_EXCEEDED', reason: `@${author} is commenting too fast.` };
  }

  const parsed = parseAndValidateComment(event, official);
  if ('error' in parsed) {
    return { status: 'REJECTED', code: parsed.code, reason: parsed.error };
  }
  const fan = parsed.voterHandle;
  const idolHandle = parsed.fandomHandle;

  const postKey = `${fan}:${parsed.mediaId}`;
  if (state.countedPostKeys.has(postKey)) {
    return { status: 'REJECTED', code: 'POST_ALREADY_COUNTED', reason: `@${fan} already scored on this post; comment on a new post.` };
  }
  state.countedPostKeys.add(postKey);

  const idol = ensureIdolProperty(state, idolHandle, parsed.commentId, event.receivedAtMs);

  const edge = `${fan}>${idolHandle}`;
  const newFan = !state.fanEdges.has(edge);
  if (newFan) {
    state.fanEdges.add(edge);
    state.fansByIdol.set(idolHandle, (state.fansByIdol.get(idolHandle) ?? 0) + 1);
    addXp(state.idolsSupportedByHandle, fan, 1);
  }
  addXp(state.countedCommentsByHandle, fan, 1);
  const idolFans = state.fansByIdol.get(idolHandle) ?? 0;

  const firstComment = !state.activeHandles.has(fan);
  let tokensGrantedMicro = 0n;
  if (firstComment) {
    // Joining mints this member's pack (A11): 90% to them, 10% to the idol they named.
    state.activeHandles.add(fan);
    const t = state.tokenomics;
    const pack = splitPack(t.members, t.fanMintedMicro);
    t.members += 1;
    t.fanMintedMicro += pack.memberMicro + pack.idolMicro;
    t.idolRoyaltiesMicro += pack.idolMicro;
    if (pack.memberMicro > 0n) {
      addTokens(state, fan, pack.memberMicro);
    }
    if (pack.idolMicro > 0n) {
      addTokens(state, idolHandle, pack.idolMicro);
    }
    tokensGrantedMicro = pack.memberMicro;
  }
  const friendXp = firstComment ? 0 : rewardFriendTags(state, fan, parsed.friendHandles, event.receivedAtMs);
  const xpGained = (firstComment ? MINT_XP : ENGAGEMENT_XP) + friendXp;
  earnXp(state, fan, firstComment ? MINT_XP : ENGAGEMENT_XP);
  earnFandomXp(state, idolHandle, newFan ? MINT_XP : ENGAGEMENT_XP);

  const existing = state.plotIndexByMinter.get(fan);
  if (existing !== undefined) {
    // They already have their one property (a home, or an anchor someone else created for them).
    return {
      status: 'ENGAGEMENT_POINTS_ONLY',
      land: state.lands[existing],
      idol,
      xpGained,
      newFan,
      idolFans,
      reason: newFan ? `@${fan} is now fan #${idolFans} of @${idolHandle}.` : `@${fan} supported @${idolHandle} again.`,
    };
  }

  const home = addProperty(state, {
    handle: fan,
    fandomHandle: idolHandle,
    idolHandle,
    footprint: 'LOT',
    city: idol.city,
    cell: placeHomeNear(state.layout, idol.city, idolHandle, idol.coordinates),
    commentId: parsed.commentId,
    atMs: event.receivedAtMs,
  });
  return { status: 'MINTED_NEW_LAND', land: home, idol, xpGained, newFan, idolFans, tokensGrantedMicro };
}

function requireListing(state: CityState, listingId: string): MarketListing {
  const listing = state.listings.get(listingId);
  if (!listing) {
    throw new MarketError('LISTING_NOT_FOUND', `Listing ${listingId} not found.`);
  }
  return listing;
}

export function applyListingCreated(state: CityState, input: CreateListingInput): MarketListing {
  assertPlayer(state, input.sellerHandle);
  if (state.listings.has(input.listingId)) {
    throw new MarketError('ALREADY_LISTED', `Listing id ${input.listingId} already exists.`);
  }
  const land = input.plotIndex === null ? undefined : state.lands[input.plotIndex];
  const plotAlreadyListed =
    input.plotIndex !== null &&
    Array.from(state.listings.values()).some(
      (l) => l.plotIndex === input.plotIndex && (l.status === 'OPEN' || l.status === 'LOCKED_ESCROW')
    );

  const listing = createMarketListing(input, {
    land,
    sellerBalanceMicro: state.tokenBalancesMicro.get(input.sellerHandle) ?? 0n,
    plotAlreadyListed,
  });

  if (listing.assetType === 'NEFA_PACK' && listing.tokenAmountMicro !== null) {
    // Escrow at listing time so the same tokens cannot be listed twice.
    addTokens(state, listing.sellerHandle, -listing.tokenAmountMicro);
  }
  state.listings.set(listing.listingId, listing);
  return listing;
}

/** Only the seller, and only while nobody is paying for it. Escrowed tokens go back to the seller. */
export function applyListingCancelled(state: CityState, listingId: string, sellerHandle: string): MarketListing {
  const listing = requireListing(state, listingId);
  if (listing.sellerHandle !== sellerHandle) {
    throw new MarketError('SELLER_NOT_OWNER', `@${sellerHandle} did not create listing ${listingId}.`);
  }
  if (listing.status !== 'OPEN') {
    throw new MarketError('LISTING_UNAVAILABLE', `Listing ${listingId} is ${listing.status} and cannot be cancelled.`);
  }
  if (listing.assetType === 'NEFA_PACK' && listing.tokenAmountMicro !== null) {
    addTokens(state, listing.sellerHandle, listing.tokenAmountMicro);
  }
  const cancelled: MarketListing = { ...listing, status: 'CANCELLED' };
  state.listings.set(listingId, cancelled);
  return cancelled;
}

export function applyLotAdSet(state: CityState, plotIndex: number, ownerHandle: string, creative: LotAd | null): LotAd | null {
  assertPlayer(state, ownerHandle);
  const land = Number.isInteger(plotIndex) ? state.lands[plotIndex] : undefined;
  if (!land) {
    throw new LotAdError('NO_SUCH_PLOT', `Plot #${plotIndex} does not exist.`);
  }
  if (land.ownerHandle !== ownerHandle) {
    throw new LotAdError('NOT_OWNER', `Only @${land.ownerHandle} can advertise on home #${plotIndex + 1}.`);
  }
  if (creative === null) {
    state.lotAds.delete(plotIndex);
    return null;
  }
  const ad = validateLotAd(creative);
  state.lotAds.set(plotIndex, ad);
  return ad;
}

export function applyTokenTransfer(state: CityState, transfer: TokenTransfer): TokenTransfer {
  assertPlayer(state, transfer.fromHandle);
  assertPlayer(state, transfer.toHandle);
  if (transfer.amountMicro <= 0n) {
    throw new MarketError('INVALID_PRICE', 'Transfer amount must be a positive integer.');
  }
  if (transfer.fromHandle === transfer.toHandle) {
    throw new MarketError('WASH_TRADE', 'You cannot send $NEFA to yourself.');
  }
  addTokens(state, transfer.fromHandle, -transfer.amountMicro);
  addTokens(state, transfer.toHandle, transfer.amountMicro);
  return transfer;
}

export function applyCheckoutLocked(state: CityState, request: CheckoutRequest): MarketListing {
  assertPlayer(state, request.buyerHandle);
  const locked = lockListingForCheckout(requireListing(state, request.listingId), request);
  state.listings.set(locked.listingId, locked);
  return locked;
}

/** Moves the property or the tokens. Reputation and fans never move: they belong to the profile. */
export function applyPaymentSettled(state: CityState, proof: SettlementProof): SettlementReceipt {
  assertPlayer(state, proof.buyerHandle);
  if (state.settledTxRefs.has(proof.externalTxRef)) {
    throw new MarketError('INVALID_TX_REF', `Payment ${proof.externalTxRef} was already applied.`);
  }
  const receipt = settleMarketListing(requireListing(state, proof.listingId), proof);
  const settled = receipt.listing;

  if (settled.assetType === 'LAND_PLOT' && settled.plotIndex !== null) {
    const land = state.lands[settled.plotIndex];
    if (!land || land.ownerHandle !== settled.sellerHandle) {
      throw new MarketError('SELLER_NOT_OWNER', `Seller no longer owns plot #${settled.plotIndex}.`);
    }
    state.lands[settled.plotIndex] = { ...land, ownerHandle: proof.buyerHandle };
    revokeDeed(state, settled.sellerHandle, settled.plotIndex);
    grantDeed(state, proof.buyerHandle, settled.plotIndex);
    // The billboard belongs to the deed, not the street: a new owner starts blank.
    state.lotAds.delete(settled.plotIndex);
  } else if (settled.assetType === 'NEFA_PACK' && settled.tokenAmountMicro !== null) {
    addTokens(state, proof.buyerHandle, settled.tokenAmountMicro);
  } else {
    throw new MarketError('INVALID_ASSET', `Listing ${settled.listingId} has no transferable asset.`);
  }

  state.listings.set(settled.listingId, settled);
  state.settledTxRefs.add(proof.externalTxRef);
  return receipt;
}

function requirePendingOffer(state: CityState, offerId: string): PropertyOffer {
  const offer = state.offers.get(offerId);
  if (!offer) {
    throw new OfferError('NO_SUCH_OFFER', `Offer ${offerId} not found.`);
  }
  if (offer.status !== 'PENDING') {
    throw new OfferError('OFFER_CLOSED', `Offer ${offerId} is already ${offer.status.toLowerCase()}.`);
  }
  return offer;
}

/** A bid to the current owner. One open bid per bidder per property: a new one replaces the old. */
export function applyOfferMade(state: CityState, input: OfferInput): PropertyOffer {
  assertPlayer(state, input.fromHandle);
  const land = Number.isInteger(input.plotIndex) ? state.lands[input.plotIndex] : undefined;
  if (!land) {
    throw new OfferError('NO_SUCH_PLOT', `Plot #${input.plotIndex} does not exist.`);
  }
  if (land.ownerHandle === input.fromHandle) {
    throw new OfferError('OWN_PROPERTY', 'This is already yours.');
  }
  if (input.amountBrlCents < MIN_OFFER_BRL_CENTS || input.amountBrlCents > MAX_OFFER_BRL_CENTS) {
    throw new OfferError('INVALID_AMOUNT', 'Offer must be between R$ 1.00 and R$ 1,000,000,000.00.');
  }
  if (state.offers.has(input.offerId)) {
    throw new OfferError('DUPLICATE_OFFER', `Offer id ${input.offerId} already exists.`);
  }
  const pending = [...state.offers.values()].filter((o) => o.status === 'PENDING');
  const replaced = pending.find((o) => o.fromHandle === input.fromHandle && o.plotIndex === input.plotIndex);
  const bidderOpen = pending.filter((o) => o.fromHandle === input.fromHandle).length - (replaced ? 1 : 0);
  if (pending.length - (replaced ? 1 : 0) >= MAX_PENDING_OFFERS || bidderOpen >= MAX_PENDING_OFFERS_PER_BIDDER) {
    throw new OfferError('TOO_MANY_OFFERS', 'Too many open offers; withdraw some first.');
  }
  if (replaced) {
    state.offers.set(replaced.offerId, { ...replaced, status: 'WITHDRAWN' });
  }
  const offer: PropertyOffer = {
    offerId: input.offerId,
    plotIndex: input.plotIndex,
    fromHandle: input.fromHandle,
    toHandle: land.ownerHandle,
    amountBrlCents: input.amountBrlCents,
    status: 'PENDING',
    createdAtIso: input.atIso,
    listingId: null,
  };
  state.offers.set(offer.offerId, offer);
  return offer;
}

export function applyOfferWithdrawn(state: CityState, offerId: string, bidderHandle: string): PropertyOffer {
  const offer = requirePendingOffer(state, offerId);
  if (offer.fromHandle !== bidderHandle) {
    throw new OfferError('NOT_BIDDER', 'Only the bidder can withdraw this offer.');
  }
  const closed: PropertyOffer = { ...offer, status: 'WITHDRAWN' };
  state.offers.set(offerId, closed);
  return closed;
}

export function applyOfferDeclined(state: CityState, offerId: string, ownerHandle: string): PropertyOffer {
  const offer = requirePendingOffer(state, offerId);
  if (offer.toHandle !== ownerHandle) {
    throw new OfferError('NOT_OWNER', 'Only the owner can answer this offer.');
  }
  const closed: PropertyOffer = { ...offer, status: 'DECLINED' };
  state.offers.set(offerId, closed);
  return closed;
}

/**
 * Accepting and listing happen in one event: the property is listed at
 * exactly the offered price, by exactly the owner who received the offer, or
 * nothing changes at all.
 */
export function applyOfferAccepted(state: CityState, offerId: string, ownerHandle: string, input: CreateListingInput): { offer: PropertyOffer; listing: MarketListing } {
  const offer = requirePendingOffer(state, offerId);
  const land = state.lands[offer.plotIndex];
  if (offer.toHandle !== ownerHandle || !land || land.ownerHandle !== ownerHandle) {
    throw new OfferError('NOT_OWNER', 'You no longer own this property.');
  }
  if (
    input.sellerHandle !== ownerHandle ||
    input.assetType !== 'LAND_PLOT' ||
    input.plotIndex !== offer.plotIndex ||
    input.priceBrlCents !== offer.amountBrlCents ||
    input.tokenAmountMicro !== null
  ) {
    throw new OfferError('OFFER_MISMATCH', 'The listing must sell this property at the offered price.');
  }
  const listing = applyListingCreated(state, input);
  const accepted: PropertyOffer = { ...offer, status: 'ACCEPTED', listingId: listing.listingId };
  state.offers.set(offerId, accepted);
  return { offer: accepted, listing };
}

export function applyLedgerEvent(state: CityState, event: LedgerEvent): LedgerEventResult {
  switch (event.kind) {
    case 'comment':
      return { kind: 'comment', outcome: applyCommentEvent(state, event.event) };
    case 'listing_created':
      return { kind: 'listing_created', listing: applyListingCreated(state, event.input) };
    case 'listing_cancelled':
      return { kind: 'listing_cancelled', listing: applyListingCancelled(state, event.listingId, event.sellerHandle) };
    case 'checkout_locked':
      return { kind: 'checkout_locked', listing: applyCheckoutLocked(state, event.request) };
    case 'payment_settled':
      return { kind: 'payment_settled', receipt: applyPaymentSettled(state, event.proof) };
    case 'token_transferred':
      return { kind: 'token_transferred', transfer: applyTokenTransfer(state, event.transfer) };
    case 'lot_ad_set':
      return { kind: 'lot_ad_set', plotIndex: event.plotIndex, ad: applyLotAdSet(state, event.plotIndex, event.ownerHandle, event.creative) };
    case 'offer_made':
      return { kind: 'offer_made', offer: applyOfferMade(state, event.offer) };
    case 'offer_withdrawn':
      return { kind: 'offer_closed', offer: applyOfferWithdrawn(state, event.offerId, event.bidderHandle) };
    case 'offer_declined':
      return { kind: 'offer_closed', offer: applyOfferDeclined(state, event.offerId, event.ownerHandle) };
    case 'offer_accepted':
      return { kind: 'offer_accepted', ...applyOfferAccepted(state, event.offerId, event.ownerHandle, event.listing) };
    default: {
      const exhaustive: never = event;
      throw new Error(`Unknown ledger event: ${JSON.stringify(exhaustive, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))}`);
    }
  }
}

export function fansOf(state: CityState, handle: string): number {
  return state.fansByIdol.get(handle) ?? 0;
}

export function propertyClassOf(state: CityState, land: LandPlot): PropertyClass {
  return propertyClassFor(fansOf(state, land.minterHandle), land.footprint);
}

/** Every handle with at least one fan, in one global ranking. */
export function computeCityStandings(state: CityState): FandomClubStats[] {
  const inputs = [];
  for (const [idol, fans] of state.fansByIdol) {
    const plot = state.plotIndexByMinter.get(idol);
    if (fans <= 0 || plot === undefined) {
      continue;
    }
    const land = state.lands[plot];
    inputs.push({
      ...resolveFandomMetadata(idol),
      fans,
      reputationXp: state.reputationXpByFandom.get(idol) ?? 0,
      district: land.coordinates,
      footprint: land.footprint,
      propertyClass: propertyClassFor(fans, land.footprint),
      city: land.city,
    });
  }
  return computeChampionshipStandings(inputs);
}

export function fanProfile(state: CityState, handle: string): FanProfile {
  const xp = state.reputationXpByHandle.get(handle) ?? 0;
  const plot = state.plotIndexByMinter.get(handle);
  const land = plot === undefined ? undefined : state.lands[plot];
  return {
    handle,
    reputationXp: xp,
    level: levelForXp(xp),
    tokenBalanceMicro: state.tokenBalancesMicro.get(handle) ?? 0n,
    fans: fansOf(state, handle),
    propertyClass: land ? propertyClassOf(state, land) : null,
    fandomHandle: land ? land.fandomHandle : null,
  };
}

/** Highest reputation first; ties by handle so the list is stable. */
export function topFans(state: CityState, limit: number): FanProfile[] {
  return Array.from(state.reputationXpByHandle.entries())
    .sort(([ha, a], [hb, b]) => b - a || ha.localeCompare(hb))
    .slice(0, limit)
    .map(([handle]) => fanProfile(state, handle));
}

/** Largest $NEFA balance first. */
export function topHolders(state: CityState, limit: number): FanProfile[] {
  return Array.from(state.tokenBalancesMicro.entries())
    .filter(([, balance]) => balance > 0n)
    .sort(([ha, a], [hb, b]) => (b > a ? 1 : b < a ? -1 : ha.localeCompare(hb)))
    .slice(0, limit)
    .map(([handle]) => fanProfile(state, handle));
}
