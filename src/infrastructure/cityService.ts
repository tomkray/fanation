/**
 * Owns the live world: replays the journal on boot, applies new events, makes
 * each one durable, and serves the world in pieces that stay small at any
 * population — a summary, properties per chunk, and a change feed. Node runs
 * this single-threaded, so events never race.
 */

import { randomBytes } from 'node:crypto';
import {
  applyLedgerEvent,
  TokenTransfer,
  CityLedgerConfig,
  CityState,
  computeCityStandings,
  createCityState,
  fansOf,
  FanProfile,
  homesOwnedBy,
  LedgerEvent,
  LedgerEventResult,
  OfferError,
  OfferInput,
  plotsOwnedBy,
  PropertyOffer,
  propertyClassOf,
  topFans,
  topHolders,
  TokenomicsState,
} from '../core/cityLedger.js';
import { CITY_SITES } from '../core/cities.js';
import { cellToMeters, chunkKeyOfCell, BLOCK_PITCH_METERS, CHUNK_BLOCKS } from '../core/cityLayout.js';
import { resolveFandomMetadata } from '../core/fandomRegistry.js';
import { CheckoutRequest, CreateListingInput, SettlementProof, SettlementReceipt } from '../core/marketplace.js';
import { movementAgainst } from '../core/momentum.js';
import type { LotAd } from '../core/lotAd.js';
import { fansForNextClass } from '../core/property.js';
import { levelForXp, levelProgress } from '../core/reputation.js';
import { CommentProcessingOutcome, FandomClubStats, InstagramCommentEvent, LandPlot, MarketListing } from '../core/types.js';
import {
  ActivityEntryDto,
  ActivityOutcome,
  ChunkSummaryDto,
  CommentSourceName,
  ListingDto,
  MeDto,
  OfferDto,
  PropertyDetailDto,
  PropertyDto,
  PropertyMarketDto,
  RankChangeDto,
  StandingDto,
  TokenomicsDto,
  UserRankDto,
  WorldChangesDto,
  WorldChunksDto,
  WorldSummaryDto,
} from '../shared/apiContract.js';
import { logger } from '../utils/logger.js';
import { MomentumTracker } from './momentumTracker.js';
import { satsFromBrlCents, usdMicroFromBrlCents } from './payments/priceQuotes.js';
import {
  ALLOCATION_BPS,
  AllocationBucket,
  bucketCapMicro,
  IDOL_ROYALTY_BPS,
  MAX_SUPPLY_MICRO,
  mintEraFor,
  seasonPrizeMicro,
  splitPack,
} from '../core/tokenomics.js';
import { EventJournal, JournalRecord, serializeRecordBody } from './persistence/eventJournal.js';
import { LedgerChain, LedgerHead, LedgerProof } from './persistence/ledgerChain.js';

function toOfferDto(offer: PropertyOffer): OfferDto {
  return {
    id: offer.offerId,
    plotIndex: offer.plotIndex,
    fromHandle: offer.fromHandle,
    toHandle: offer.toHandle,
    amountBrlCents: offer.amountBrlCents.toString(),
    status: offer.status,
    createdAtIso: offer.createdAtIso,
    listingId: offer.listingId,
  };
}

/** One record's inclusion proof; `record` (its exact hashed bytes) only for the people in it. */
export interface LedgerProofView extends LedgerProof {
  readonly record: string | null;
}

export const DEFAULT_MOMENTUM_WINDOW_MS = 3_600_000;

const ACTIVITY_FEED_SIZE = 60;
const ACTIVITY_TEXT_MAX = 140;
const STANDINGS_IN_SUMMARY = 100;
const USER_RANK_SIZE = 20;
/** Momentum only needs the head of the ranking, sampled at most this often (event time). */
const MOMENTUM_TOP_N = 200;
const MOMENTUM_SAMPLE_MS = 1_000;
const CHANGE_FEED_VERSIONS = 5_000;
const MAX_CHUNKS_PER_REQUEST = 64;
const MIN_PLANET_RADIUS_M = 3_000;

export type CityChangeListener = (version: number) => void;
export type CommentObserver = (events: readonly InstagramCommentEvent[], source: CommentSourceName) => void;

interface ChunkStats {
  readonly key: string;
  readonly plots: number[];
  readonly colorCounts: Map<string, number>;
  dominantHandle: string;
  dominantCount: number;
}

function toActivityOutcome(outcome: CommentProcessingOutcome): ActivityOutcome {
  if (outcome.status === 'REJECTED') {
    return { status: outcome.status, code: outcome.code };
  }
  return {
    status: outcome.status,
    plotIndex: outcome.land.plotIndex,
    idolHandle: outcome.idol.minterHandle,
    idolFans: outcome.idolFans,
    newFan: outcome.newFan,
    xpGained: outcome.xpGained,
    tokensGrantedMicro: outcome.status === 'MINTED_NEW_LAND' && outcome.tokensGrantedMicro > 0n ? outcome.tokensGrantedMicro.toString() : null,
  };
}

function toTokenomicsDto(t: TokenomicsState): TokenomicsDto {
  const emitted: Readonly<Record<AllocationBucket, bigint>> = {
    FAN_MINT: t.fanMintedMicro,
    SEASONS: t.seasonPaidMicro,
    LIQUIDITY: 0n,
    TREASURY: 0n,
    ECOSYSTEM: 0n,
  };
  const era = mintEraFor(t.members);
  const buckets = (Object.keys(ALLOCATION_BPS) as AllocationBucket[]).map((bucket) => ({
    bucket,
    bps: Number(ALLOCATION_BPS[bucket]),
    capMicro: bucketCapMicro(bucket).toString(),
    emittedMicro: emitted[bucket].toString(),
    locked: bucket !== 'FAN_MINT' && bucket !== 'SEASONS',
  }));
  return {
    symbol: 'NEFA',
    maxSupplyMicro: MAX_SUPPLY_MICRO.toString(),
    mintedMicro: (t.fanMintedMicro + t.seasonPaidMicro).toString(),
    buckets,
    fanMint: {
      members: t.members,
      era: era.era,
      packMicro: splitPack(t.members, t.fanMintedMicro).memberMicro.toString(),
      nextEraAtMember: era.nextEraAtMember,
      idolRoyaltyBps: Number(IDOL_ROYALTY_BPS),
    },
    seasons: {
      current: Number.isFinite(t.season) ? t.season - t.firstSeason + 1 : null,
      nextPrizeMicro: seasonPrizeMicro(t.seasonPaidMicro).toString(),
      last: t.lastSeason
        ? {
            season: t.lastSeason.season,
            prizeMicro: t.lastSeason.prizeMicro.toString(),
            paidMicro: t.lastSeason.paidMicro.toString(),
            top: t.lastSeason.top.map((w) => ({ handle: w.handle, micro: w.micro.toString() })),
          }
        : null,
    },
  };
}

function toListingDto(listing: MarketListing): ListingDto {
  return {
    listingId: listing.listingId,
    sellerHandle: listing.sellerHandle,
    assetType: listing.assetType,
    plotIndex: listing.plotIndex,
    tokenAmountMicro: listing.tokenAmountMicro?.toString() ?? null,
    priceBrlCents: listing.priceBrlCents.toString(),
    priceUsdtMicro: listing.priceUsdtMicro.toString(),
    priceBtcSats: listing.priceBtcSats.toString(),
    status: listing.status,
    lock: listing.lock
      ? { buyerHandle: listing.lock.buyerHandle, paymentMethod: listing.lock.paymentMethod, expiresAtIso: new Date(listing.lock.expiresAtMs).toISOString() }
      : null,
    buyerHandle: listing.buyerHandle,
    settledAtIso: listing.settledAtIso,
  };
}

function toUserRank(profile: FanProfile): UserRankDto {
  return {
    handle: profile.handle,
    reputationXp: profile.reputationXp,
    level: profile.level,
    levelProgress: levelProgress(profile.reputationXp),
    tokenBalanceMicro: profile.tokenBalanceMicro.toString(),
    fans: profile.fans,
    propertyClass: profile.propertyClass,
    fandomHandle: profile.fandomHandle,
  };
}

export class CityService {
  private readonly state: CityState;
  private readonly activity: ActivityEntryDto[] = [];
  private readonly listeners = new Set<CityChangeListener>();
  private readonly commentObservers = new Set<CommentObserver>();
  private readonly sourcesSeen = new Set<JournalRecord['source']>();
  private readonly momentum: MomentumTracker;
  private readonly chunks = new Map<string, ChunkStats>();
  private readonly propertiesPerCity = new Map<string, number>();
  /** Change feed: version → plots that changed in it, oldest first. */
  private readonly changes: { readonly version: number; readonly plots: readonly number[] }[] = [];
  private maxRadius = 0;
  private rebuildsIndexed = 0;
  /** Version at which the map was last reorganized; older change-feed cursors must reload. */
  private lastRebuildVersion = 0;
  private lastMomentumAt = Number.NEGATIVE_INFINITY;
  private seq = 0;
  private version = 0;
  private readonly chain = new LedgerChain();
  /** Hashed bytes and the @s involved, for market, payment and wallet records (comments are public on Instagram). */
  private readonly ownBodies = new Map<number, { readonly body: string; readonly parties: readonly string[] }>();
  private summaryCache: { readonly version: number; readonly value: WorldSummaryDto } | null = null;
  private standingsCache: { readonly version: number; readonly value: FandomClubStats[]; readonly rankByHandle: Map<string, number> } | null = null;

  constructor(
    ledgerConfig: CityLedgerConfig,
    private readonly journal: EventJournal,
    private readonly onFatal: (err: Error) => void,
    momentumWindowMs: number = DEFAULT_MOMENTUM_WINDOW_MS,
    /** Comments older than this never mint. Null keeps every comment (the local demo). */
    private readonly liveFromMs: number | null = null
  ) {
    this.state = createCityState(ledgerConfig);
    this.momentum = new MomentumTracker(momentumWindowMs);
  }

  /** Replays every journal line; any line that no longer applies halts the boot. */
  boot(): number {
    const records = this.journal.load();
    for (const record of records) {
      try {
        // The hash is checked before the event is trusted: an edited line never reaches the reducer.
        const body = serializeRecordBody(record);
        const parties = this.partiesOf(record.event);
        this.chain.append(record.seq, body, record.hash);
        this.rememberBody(record, body, parties);
        const before = this.state.lands.length;
        const result = applyLedgerEvent(this.state, record.event);
        if (!this.reindexAfterRebuild()) {
          this.indexNewProperties(before);
        }
        this.recordActivity(record, result);
        this.trackMomentum(record, result);
        this.sourcesSeen.add(record.source);
        this.seq = Math.max(this.seq, record.seq);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Journal replay halted at seq ${record.seq}: ${reason}`);
      }
    }
    this.version = this.seq;
    logger.info('city_replayed', { records: records.length, properties: this.state.lands.length, ledgerHead: this.chain.headInfo.chainHash });
    return records.length;
  }

  /** The public fingerprint of the whole book: publish it, and any later rewrite stops matching. */
  ledgerHead(): LedgerHead {
    return this.chain.headInfo;
  }

  /** Proves record `seq` is in the book. Its bytes are shown only to the @s it involves. */
  ledgerProof(seq: number, viewer: string | null): LedgerProofView | null {
    const proof = this.chain.proof(seq);
    if (!proof) {
      return null;
    }
    const own = this.ownBodies.get(seq);
    return { ...proof, record: own && viewer !== null && own.parties.includes(viewer) ? own.body : null };
  }

  private partiesOf(event: LedgerEvent): string[] {
    switch (event.kind) {
      case 'comment':
        return [];
      case 'listing_created':
        return [event.input.sellerHandle];
      case 'listing_cancelled':
        return [event.sellerHandle];
      case 'checkout_locked': {
        const seller = this.state.listings.get(event.request.listingId)?.sellerHandle;
        return seller ? [event.request.buyerHandle, seller] : [event.request.buyerHandle];
      }
      case 'payment_settled': {
        const seller = this.state.listings.get(event.proof.listingId)?.sellerHandle;
        return seller ? [event.proof.buyerHandle, seller] : [event.proof.buyerHandle];
      }
      case 'token_transferred':
        return [event.transfer.fromHandle, event.transfer.toHandle];
      case 'lot_ad_set':
        return [event.ownerHandle];
      case 'offer_made': {
        const owner = this.ownerOf(event.offer.plotIndex);
        return owner ? [event.offer.fromHandle, owner] : [event.offer.fromHandle];
      }
      case 'offer_withdrawn':
      case 'offer_declined':
      case 'offer_accepted': {
        const offer = this.state.offers.get(event.offerId);
        return offer ? [offer.fromHandle, offer.toHandle] : [];
      }
      default: {
        const exhaustive: never = event;
        throw new Error(`Unknown ledger event ${String((exhaustive as { kind?: unknown }).kind)}`);
      }
    }
  }

  private rememberBody(record: JournalRecord, body: string, parties: readonly string[]): void {
    if (record.event.kind !== 'comment') {
      this.ownBodies.set(record.seq, { body, parties });
    }
  }

  subscribe(listener: CityChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get currentVersion(): number {
    return this.version;
  }

  /** Which event sources this journal already contains (e.g. to refuse mixing demo and real fans). */
  get journalSources(): ReadonlySet<JournalRecord['source']> {
    return this.sourcesSeen;
  }

  get stateView(): Readonly<CityState> {
    return this.state;
  }

  /** Sees every fresh comment before it is applied (e.g. handle verification codes). */
  observeComments(observer: CommentObserver): () => void {
    this.commentObservers.add(observer);
    return () => this.commentObservers.delete(observer);
  }

  /** Earliest comment first, so arrival order (and therefore proximity) is fair. */
  ingestComments(events: readonly InstagramCommentEvent[], source: CommentSourceName): CommentProcessingOutcome[] {
    const opened = events.filter((event) => this.liveFromMs === null || event.receivedAtMs >= this.liveFromMs);
    const fresh = opened
      .filter((e) => !this.state.processedCommentIds.has(e.commentId))
      .sort((a, b) => a.receivedAtMs - b.receivedAtMs || a.commentId.localeCompare(b.commentId));
    for (const observer of this.commentObservers) {
      try {
        observer(fresh, source);
      } catch (err) {
        // An observer must never stop comments from building the city.
        logger.warn('comment_observer_failed', { message: err instanceof Error ? err.message : String(err) });
      }
    }

    const outcomes: CommentProcessingOutcome[] = [];
    for (const event of fresh) {
      const result = this.commit({ kind: 'comment', event }, source);
      if (result.kind === 'comment') {
        outcomes.push(result.outcome);
      }
    }
    if (fresh.length > 0) {
      this.notify();
    }
    return outcomes;
  }

  createListing(input: CreateListingInput): MarketListing {
    const result = this.commit({ kind: 'listing_created', input }, 'market');
    this.notify();
    if (result.kind !== 'listing_created') {
      throw new Error('Unexpected ledger result for listing_created.');
    }
    return result.listing;
  }

  lockCheckout(request: CheckoutRequest): MarketListing {
    const result = this.commit({ kind: 'checkout_locked', request }, 'market');
    this.notify();
    if (result.kind !== 'checkout_locked') {
      throw new Error('Unexpected ledger result for checkout_locked.');
    }
    return result.listing;
  }

  /** Returns null when the payment was already applied (provider retry). */
  settlePayment(proof: SettlementProof): SettlementReceipt | null {
    if (this.state.settledTxRefs.has(proof.externalTxRef)) {
      return null;
    }
    const result = this.commit({ kind: 'payment_settled', proof }, 'payment');
    this.notify();
    if (result.kind !== 'payment_settled') {
      throw new Error('Unexpected ledger result for payment_settled.');
    }
    return result.receipt;
  }

  getListing(listingId: string): MarketListing | undefined {
    return this.state.listings.get(listingId);
  }

  // ---------------------------------------------------------------- reads

  summary(nowMs: number = Date.now()): WorldSummaryDto {
    if (this.summaryCache?.version === this.version) {
      return this.summaryCache.value;
    }
    const { value: all } = this.standings();
    const baseline = this.momentum.baseline(nowMs);
    const standings: StandingDto[] = all.slice(0, STANDINGS_IN_SUMMARY).map((s) => ({
      fandomHandle: s.fandomHandle,
      displayName: s.displayName,
      category: s.category,
      neonColorHex: s.neonColorHex,
      fans: s.fans,
      reputationXp: s.reputationXp,
      districtX: s.district.x,
      districtZ: s.district.z,
      footprint: s.footprint,
      propertyClass: s.propertyClass,
      city: s.city,
      rankPosition: s.rankPosition,
      perks: s.perks,
      movement: movementAgainst(baseline, s),
    }));
    const rankChanges: RankChangeDto[] = this.momentum.recentChanges.map((change) => {
      const meta = resolveFandomMetadata(change.fandomHandle);
      return {
        atIso: new Date(change.atMs).toISOString(),
        fandomHandle: change.fandomHandle,
        displayName: meta.displayName,
        neonColorHex: meta.neonColorHex,
        fromRank: change.fromRank,
        toRank: change.toRank,
      };
    });
    const chunkPitch = CHUNK_BLOCKS * BLOCK_PITCH_METERS;
    const chunks: ChunkSummaryDto[] = Array.from(this.chunks.values(), (c) => {
      const [cx, cz] = c.key.split(':').map(Number);
      return {
        key: c.key,
        x: (cx + 0.5) * chunkPitch,
        z: (cz + 0.5) * chunkPitch,
        count: c.plots.length,
        colorHex: resolveFandomMetadata(c.dominantHandle).neonColorHex,
      };
    });
    const value: WorldSummaryDto = {
      version: this.version,
      generatedAtIso: new Date(nowMs).toISOString(),
      totals: {
        properties: this.state.lands.length,
        idols: all.length,
        activeFans: this.state.activeHandles.size,
        commentsProcessed: this.state.processedCommentIds.size,
      },
      standings,
      rankChanges,
      topByXp: topFans(this.state, USER_RANK_SIZE).map(toUserRank),
      topByTokens: topHolders(this.state, USER_RANK_SIZE).map(toUserRank),
      listings: Array.from(this.state.listings.values(), toListingDto),
      activity: [...this.activity],
      cities: CITY_SITES.map((site) => ({
        id: site.id,
        name: site.name,
        ...cellToMeters(site.centerQ, site.centerR),
        colorHex: site.colorHex,
        properties: this.propertiesPerCity.get(site.id) ?? 0,
      })),
      chunks,
      planetRadius: Math.max(MIN_PLANET_RADIUS_M, this.maxRadius / 1.4),
      tokenomics: toTokenomicsDto(this.state.tokenomics),
    };
    this.summaryCache = { version: this.version, value };
    return value;
  }

  chunksByKey(keys: readonly string[]): WorldChunksDto {
    const unique = [...new Set(keys)].slice(0, MAX_CHUNKS_PER_REQUEST);
    return {
      version: this.version,
      chunks: unique.map((key) => ({
        key,
        properties: (this.chunks.get(key)?.plots ?? []).map((plot) => this.toPropertyDto(this.state.lands[plot])),
      })),
    };
  }

  changesSince(since: number): WorldChangesDto {
    const oldest = this.changes[0]?.version ?? this.version;
    if ((since < oldest - 1 && since < this.version) || since < this.lastRebuildVersion) {
      return { version: this.version, reset: true, properties: [] };
    }
    const plots = new Set<number>();
    for (const change of this.changes) {
      if (change.version > since) {
        change.plots.forEach((p) => plots.add(p));
      }
    }
    return { version: this.version, reset: false, properties: [...plots].map((p) => this.toPropertyDto(this.state.lands[p])) };
  }

  propertyDetail(plotIndex: number, pendingOffers = 0): PropertyDetailDto | null {
    const land = Number.isInteger(plotIndex) ? this.state.lands[plotIndex] : undefined;
    if (!land) {
      return null;
    }
    const meta = resolveFandomMetadata(land.minterHandle);
    const ownerXp = this.state.reputationXpByHandle.get(land.ownerHandle) ?? 0;
    const fans = fansOf(this.state, land.minterHandle);
    return {
      ...this.toPropertyDto(land),
      displayName: meta.category === 'UNLISTED' ? null : meta.displayName,
      category: meta.category,
      ownerReputationXp: ownerXp,
      ownerLevelProgress: levelProgress(ownerXp),
      ownerTokenBalanceMicro: (this.state.tokenBalancesMicro.get(land.ownerHandle) ?? 0n).toString(),
      idolReputationXp: this.state.reputationXpByFandom.get(land.minterHandle) ?? 0,
      idolRank: fans > 0 ? this.standings().rankByHandle.get(land.minterHandle) ?? null : null,
      nextClassAtFans: fansForNextClass(fans, land.footprint),
      mintedAtIso: land.mintedAtIso,
      market: this.marketOf(land.plotIndex, pendingOffers),
      ownerHomes: homesOwnedBy(this.state, land.ownerHandle),
      lotAd: this.state.lotAds.get(land.plotIndex) ?? null,
    };
  }

  profileDetail(handle: string, pendingOffers = 0): PropertyDetailDto | null {
    const plot = this.state.plotIndexByMinter.get(handle);
    return plot === undefined ? null : this.propertyDetail(plot, pendingOffers);
  }

  /** The signed-in profile, without offers (they live in the offer book). */
  me(handle: string): Omit<MeDto, 'offersReceived' | 'offersMade'> {
    const xp = this.state.reputationXpByHandle.get(handle) ?? 0;
    const fans = fansOf(this.state, handle);
    const owned = plotsOwnedBy(this.state, handle);
    const minted = this.state.plotIndexByMinter.get(handle);
    const listings: ListingDto[] = [];
    for (const listing of this.state.listings.values()) {
      if (listing.sellerHandle === handle && (listing.status === 'OPEN' || listing.status === 'LOCKED_ESCROW')) {
        listings.push(toListingDto(listing));
      }
    }
    return {
      handle,
      reputationXp: xp,
      level: levelForXp(xp),
      levelProgress: levelProgress(xp),
      tokenBalanceMicro: (this.state.tokenBalancesMicro.get(handle) ?? 0n).toString(),
      fans,
      idolsSupported: this.state.idolsSupportedByHandle.get(handle) ?? 0,
      countedComments: this.state.countedCommentsByHandle.get(handle) ?? 0,
      idolRank: fans > 0 ? this.standings().rankByHandle.get(handle) ?? null : null,
      homesOwned: owned.length,
      mintedPlotIndex: minted === undefined ? null : minted,
      properties: owned.map((plot) => this.toPropertyDto(this.state.lands[plot])),
      listings,
    };
  }

  ownerOf(plotIndex: number): string | null {
    return Number.isInteger(plotIndex) ? this.state.lands[plotIndex]?.ownerHandle ?? null : null;
  }

  /** Owner sets or clears the billboard on a lot they hold. */
  setLotAd(ownerHandle: string, plotIndex: number, creative: LotAd | null): LotAd | null {
    const result = this.commit({ kind: 'lot_ad_set', plotIndex, ownerHandle, creative }, 'wallet');
    this.notify();
    if (result.kind !== 'lot_ad_set') {
      throw new Error('Unexpected ledger result for lot_ad_set.');
    }
    return result.ad;
  }

  /** The owner puts a property they hold up for sale, priced in BRL (USDT/BTC derived). */
  listProperty(sellerHandle: string, plotIndex: number, priceBrlCents: bigint): MarketListing {
    return this.createListing({
      listingId: `lst_${randomBytes(8).toString('hex')}`,
      sellerHandle,
      assetType: 'LAND_PLOT',
      plotIndex,
      tokenAmountMicro: null,
      priceBrlCents,
      priceUsdtMicro: usdMicroFromBrlCents(priceBrlCents),
      priceBtcSats: satsFromBrlCents(priceBrlCents),
      nowIso: new Date().toISOString(),
    });
  }

  cancelListing(listingId: string, sellerHandle: string): MarketListing {
    const result = this.commit({ kind: 'listing_cancelled', listingId, sellerHandle }, 'wallet');
    this.notify();
    if (result.kind !== 'listing_cancelled') {
      throw new Error('Unexpected ledger result for listing_cancelled.');
    }
    return result.listing;
  }

  makeOffer(fromHandle: string, plotIndex: number, amountBrlCents: bigint): OfferDto {
    const offer: OfferInput = { offerId: `off_${randomBytes(8).toString('hex')}`, plotIndex, fromHandle, amountBrlCents, atIso: new Date().toISOString() };
    const result = this.commit({ kind: 'offer_made', offer }, 'wallet');
    this.notify();
    if (result.kind !== 'offer_made') {
      throw new Error('Unexpected ledger result for offer_made.');
    }
    return toOfferDto(result.offer);
  }

  withdrawOffer(offerId: string, bidderHandle: string): OfferDto {
    return this.closeOffer({ kind: 'offer_withdrawn', offerId, bidderHandle });
  }

  declineOffer(offerId: string, ownerHandle: string): OfferDto {
    return this.closeOffer({ kind: 'offer_declined', offerId, ownerHandle });
  }

  /** Lists the property at the offered price in the same ledger event; the bidder then pays by checkout. */
  acceptOffer(offerId: string, ownerHandle: string): OfferDto {
    const offer = this.state.offers.get(offerId);
    if (!offer) {
      throw new OfferError('NO_SUCH_OFFER', `Offer ${offerId} not found.`);
    }
    const listing: CreateListingInput = {
      listingId: `lst_${randomBytes(8).toString('hex')}`,
      sellerHandle: ownerHandle,
      assetType: 'LAND_PLOT',
      plotIndex: offer.plotIndex,
      tokenAmountMicro: null,
      priceBrlCents: offer.amountBrlCents,
      priceUsdtMicro: usdMicroFromBrlCents(offer.amountBrlCents),
      priceBtcSats: satsFromBrlCents(offer.amountBrlCents),
      nowIso: new Date().toISOString(),
    };
    const result = this.commit({ kind: 'offer_accepted', offerId, ownerHandle, listing }, 'wallet');
    this.notify();
    if (result.kind !== 'offer_accepted') {
      throw new Error('Unexpected ledger result for offer_accepted.');
    }
    return toOfferDto(result.offer);
  }

  offersReceived(handle: string): OfferDto[] {
    return this.offersWhere((o) => o.toHandle === handle);
  }

  offersMade(handle: string): OfferDto[] {
    return this.offersWhere((o) => o.fromHandle === handle);
  }

  pendingOfferCount(plotIndex: number): number {
    let count = 0;
    for (const o of this.state.offers.values()) {
      if (o.plotIndex === plotIndex && o.status === 'PENDING') {
        count += 1;
      }
    }
    return count;
  }

  private offersWhere(match: (offer: PropertyOffer) => boolean): OfferDto[] {
    return [...this.state.offers.values()]
      .filter(match)
      .sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso))
      .slice(0, 50)
      .map(toOfferDto);
  }

  private closeOffer(event: Extract<LedgerEvent, { kind: 'offer_withdrawn' | 'offer_declined' }>): OfferDto {
    const result = this.commit(event, 'wallet');
    this.notify();
    if (result.kind !== 'offer_closed') {
      throw new Error(`Unexpected ledger result for ${event.kind}.`);
    }
    return toOfferDto(result.offer);
  }

  transferTokens(fromHandle: string, toHandle: string, amountMicro: bigint): TokenTransfer {
    const transfer: TokenTransfer = { transferId: `tx_${randomBytes(8).toString('hex')}`, fromHandle, toHandle, amountMicro, atIso: new Date().toISOString() };
    const result = this.commit({ kind: 'token_transferred', transfer }, 'wallet');
    this.notify();
    if (result.kind !== 'token_transferred') {
      throw new Error('Unexpected ledger result for token_transferred.');
    }
    return result.transfer;
  }

  private marketOf(plotIndex: number, pendingOffers: number): PropertyMarketDto {
    let listing: PropertyMarketDto['listing'] = null;
    const sales: { priceBrlCents: string; sellerHandle: string; buyerHandle: string; settledAtIso: string }[] = [];
    for (const l of this.state.listings.values()) {
      if (l.plotIndex !== plotIndex) {
        continue;
      }
      if (l.status === 'OPEN' || l.status === 'LOCKED_ESCROW') {
        listing = { listingId: l.listingId, priceBrlCents: l.priceBrlCents.toString(), status: l.status, sellerHandle: l.sellerHandle };
      } else if (l.status === 'SETTLED' && l.buyerHandle && l.settledAtIso) {
        sales.push({ priceBrlCents: l.priceBrlCents.toString(), sellerHandle: l.sellerHandle, buyerHandle: l.buyerHandle, settledAtIso: l.settledAtIso });
      }
    }
    sales.sort((a, b) => b.settledAtIso.localeCompare(a.settledAtIso));
    return { listing, sales, pendingOffers };
  }

  /** True when this @ already lives in the city, so a portrait lookup is not an open search. */
  knowsHandle(handle: string): boolean {
    return this.state.activeHandles.has(handle) || this.state.plotIndexByMinter.has(handle) || (this.state.plotsByOwner.get(handle)?.size ?? 0) > 0;
  }

  /** Handles worth showing a real profile picture for: the head of the ranking. */
  topIdolHandles(limit: number): string[] {
    return this.standings().value.slice(0, limit).map((s) => s.fandomHandle);
  }

  // ---------------------------------------------------------------- internals

  private standings(): { value: FandomClubStats[]; rankByHandle: Map<string, number> } {
    if (this.standingsCache?.version !== this.version) {
      const value = computeCityStandings(this.state);
      this.standingsCache = { version: this.version, value, rankByHandle: new Map(value.map((s) => [s.fandomHandle, s.rankPosition])) };
    }
    return this.standingsCache;
  }

  private toPropertyDto(land: LandPlot): PropertyDto {
    const ownerXp = this.state.reputationXpByHandle.get(land.ownerHandle) ?? 0;
    return {
      plotIndex: land.plotIndex,
      handle: land.ownerHandle,
      minterHandle: land.minterHandle,
      districtHandle: land.fandomHandle,
      idolHandle: land.idolHandle,
      x: land.coordinates.x,
      z: land.coordinates.z,
      footprint: land.footprint,
      propertyClass: propertyClassOf(this.state, land),
      fans: fansOf(this.state, land.minterHandle),
      level: levelForXp(ownerXp),
      colorHex: resolveFandomMetadata(land.fandomHandle).neonColorHex,
      city: land.city,
      neighbourhoods: (this.state.layout.neighbourhoods.get(land.minterHandle) ?? []).map((cell) => cellToMeters(cell.gridQ, cell.gridR)),
    };
  }

  /** After a layout epoch every property may have moved: rebuild the spatial indexes from scratch. */
  private reindexAfterRebuild(): boolean {
    if (this.state.layoutEpoch.rebuilds === this.rebuildsIndexed) {
      return false;
    }
    this.rebuildsIndexed = this.state.layoutEpoch.rebuilds;
    this.chunks.clear();
    this.propertiesPerCity.clear();
    this.maxRadius = 0;
    this.indexNewProperties(0);
    return true;
  }

  /** Between layout epochs properties are only appended, so indexing new ones keeps every index exact. */
  private indexNewProperties(from: number): void {
    for (let plot = from; plot < this.state.lands.length; plot += 1) {
      const land = this.state.lands[plot];
      const key = chunkKeyOfCell(land.coordinates.gridQ, land.coordinates.gridR);
      let chunk = this.chunks.get(key);
      if (!chunk) {
        chunk = { key, plots: [], colorCounts: new Map(), dominantHandle: land.fandomHandle, dominantCount: 0 };
        this.chunks.set(key, chunk);
      }
      chunk.plots.push(plot);
      const count = (chunk.colorCounts.get(land.fandomHandle) ?? 0) + 1;
      chunk.colorCounts.set(land.fandomHandle, count);
      if (count > chunk.dominantCount) {
        chunk.dominantCount = count;
        chunk.dominantHandle = land.fandomHandle;
      }
      this.propertiesPerCity.set(land.city, (this.propertiesPerCity.get(land.city) ?? 0) + 1);
      this.maxRadius = Math.max(this.maxRadius, Math.hypot(land.coordinates.x, land.coordinates.z));
    }
  }

  private changedPlots(result: LedgerEventResult): number[] {
    switch (result.kind) {
      case 'comment':
        return result.outcome.status === 'REJECTED' ? [] : [result.outcome.land.plotIndex, result.outcome.idol.plotIndex];
      case 'payment_settled':
        return result.receipt.listing.plotIndex === null ? [] : [result.receipt.listing.plotIndex];
      case 'listing_created':
      case 'listing_cancelled':
      case 'checkout_locked':
        // Listings travel in the summary; the map itself does not change.
        return [];
      case 'token_transferred':
      case 'offer_made':
      case 'offer_closed':
      case 'offer_accepted':
        // Offers and the listing an accepted offer opens travel in property details, not the map.
        return [];
      case 'lot_ad_set':
        return [result.plotIndex];
      default: {
        const exhaustive: never = result;
        throw new Error(`Unknown result ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /**
   * Apply first (it may throw a domain error and change nothing), then make it
   * durable. If durability fails the in-memory state is ahead of disk, so the
   * process must stop and replay rather than keep serving a world it cannot prove.
   */
  private commit(event: LedgerEvent, source: JournalRecord['source']): LedgerEventResult {
    const before = this.state.lands.length;
    // Parties are read before applying: a settlement may move the listing it names.
    const parties = this.partiesOf(event);
    const result = applyLedgerEvent(this.state, event);
    const unsigned: JournalRecord = { seq: this.seq + 1, atIso: new Date().toISOString(), source, event };
    const body = serializeRecordBody(unsigned);
    const record: JournalRecord = { ...unsigned, hash: this.chain.nextLink(body) };
    try {
      this.journal.append(record);
    } catch (err) {
      const fatal = err instanceof Error ? err : new Error(String(err));
      this.onFatal(fatal);
      throw fatal;
    }
    this.chain.append(record.seq, body, record.hash);
    this.rememberBody(record, body, parties);
    this.seq = record.seq;
    this.version = record.seq;
    if (this.reindexAfterRebuild()) {
      this.lastRebuildVersion = this.version;
    } else {
      this.indexNewProperties(before);
    }
    const plots = this.changedPlots(result);
    if (plots.length > 0) {
      this.changes.push({ version: this.version, plots });
      if (this.changes.length > CHANGE_FEED_VERSIONS) {
        this.changes.splice(0, this.changes.length - CHANGE_FEED_VERSIONS);
      }
    }
    this.sourcesSeen.add(source);
    this.recordActivity(record, result);
    this.trackMomentum(record, result);
    return result;
  }

  /**
   * Accepted comments move the ranking; sampling is throttled by comment time,
   * so a replay samples history exactly as it was sampled live.
   */
  private trackMomentum(record: JournalRecord, result: LedgerEventResult): void {
    if (record.event.kind !== 'comment' || result.kind !== 'comment' || result.outcome.status === 'REJECTED') {
      return;
    }
    const at = record.event.event.receivedAtMs;
    if (at - this.lastMomentumAt >= MOMENTUM_SAMPLE_MS) {
      this.sampleMomentum(at);
    }
  }

  private sampleMomentum(atMs: number): void {
    this.lastMomentumAt = atMs;
    this.momentum.record(atMs, computeCityStandings(this.state).slice(0, MOMENTUM_TOP_N));
  }

  private recordActivity(record: JournalRecord, result: LedgerEventResult): void {
    if (record.event.kind !== 'comment' || result.kind !== 'comment') {
      return;
    }
    const source = record.source;
    if (source === 'market' || source === 'payment' || source === 'wallet') {
      logger.warn('activity_comment_with_market_source', { seq: record.seq });
      return;
    }
    // The official account's own replies are not activity: it never plays.
    if (result.outcome.status === 'REJECTED' && result.outcome.code === 'OWN_ACCOUNT_COMMENT') {
      return;
    }
    const { event } = record.event;
    this.activity.unshift({
      commentId: event.commentId,
      atIso: new Date(event.receivedAtMs).toISOString(),
      source,
      authorUsername: event.authorUsername.slice(0, 30),
      text: event.text.slice(0, ACTIVITY_TEXT_MAX),
      mediaId: event.mediaId,
      outcome: toActivityOutcome(result.outcome),
    });
    if (this.activity.length > ACTIVITY_FEED_SIZE) {
      this.activity.length = ACTIVITY_FEED_SIZE;
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.version);
      } catch (err) {
        logger.warn('city_listener_failed', { message: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}
