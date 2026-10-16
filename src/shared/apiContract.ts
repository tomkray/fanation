/**
 * JSON contract between the API and the browser. Money integers that may
 * exceed 2^53 (token micro-units, prices) travel as decimal strings; XP and
 * fan counts are plain integers.
 *
 * Scale rule: nothing here grows with the size of the world except
 * `chunks` (one small row per ~500 m square). Properties are fetched per
 * chunk for what the camera sees, and updates arrive as a change feed.
 */

import type { AdCity, AdPlacement, AdStatus } from '../core/ads.js';
import type { CityId } from '../core/cities.js';
import type { AllocationBucket } from '../core/tokenomics.js';
import type { PropertyClass, PropertyFootprint } from '../core/property.js';
import type { CommentRejectionCode, FandomCategory, ListingAssetType, ListingStatus, PaymentMethod } from '../core/types.js';

export type CommentSourceName = 'instagram_webhook' | 'instagram_poll' | 'simulated';

/** What the map needs to draw one property. */
export interface PropertyDto {
  readonly plotIndex: number;
  /** Current owner's @handle. */
  readonly handle: string;
  /** The @handle this property was created for (never changes). */
  readonly minterHandle: string;
  /** District colour/identity: the idol it was built next to, or itself. */
  readonly districtHandle: string;
  readonly idolHandle: string | null;
  readonly x: number;
  readonly z: number;
  readonly footprint: PropertyFootprint;
  readonly propertyClass: PropertyClass;
  /** People who named this @handle as their idol. */
  readonly fans: number;
  /** Owner's reputation level: drives the building's finish. */
  readonly level: number;
  readonly colorHex: string;
  readonly city: CityId;
  /** Where this idol's neighbourhood continued after being closed in (metres); drawn as neon links. */
  readonly neighbourhoods: readonly { readonly x: number; readonly z: number }[];
}

/** Everything a card needs about one property and the profile living in it. */
export interface PropertyDetailDto extends PropertyDto {
  readonly displayName: string | null;
  readonly category: FandomCategory;
  readonly ownerReputationXp: number;
  readonly ownerLevelProgress: number;
  readonly ownerTokenBalanceMicro: string;
  readonly idolReputationXp: number;
  /** Position in the global idol ranking, when this profile has fans. */
  readonly idolRank: number | null;
  readonly nextClassAtFans: number | null;
  readonly mintedAtIso: string;
  readonly market: PropertyMarketDto;
  /** How many deeds the current owner holds (the Monopoly bank). */
  readonly ownerHomes: number;
  /** Billboard the owner put on this lot; null when the lot is silent. */
  readonly lotAd: LotAdDto | null;
}

export interface LotAdDto {
  readonly headline: string;
  readonly tagline: string;
  readonly backgroundHex: string;
  readonly accentHex: string;
}

/** Is it for sale, what did it sell for, and how many open offers are waiting. */
export interface PropertyMarketDto {
  readonly listing: {
    readonly listingId: string;
    readonly priceBrlCents: string;
    readonly status: ListingStatus;
    readonly sellerHandle: string;
  } | null;
  readonly sales: readonly { readonly priceBrlCents: string; readonly sellerHandle: string; readonly buyerHandle: string; readonly settledAtIso: string }[];
  readonly pendingOffers: number;
}

export type OfferStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN';

export interface OfferDto {
  readonly id: string;
  readonly plotIndex: number;
  readonly fromHandle: string;
  readonly toHandle: string;
  readonly amountBrlCents: string;
  readonly status: OfferStatus;
  readonly createdAtIso: string;
  /** Set when an accepted offer became a listing the bidder can buy. */
  readonly listingId: string | null;
}

/** The signed-in profile: everything its owner controls and every stat they earned. */
export interface MeDto {
  readonly handle: string;
  readonly reputationXp: number;
  readonly level: number;
  readonly levelProgress: number;
  readonly tokenBalanceMicro: string;
  readonly fans: number;
  readonly idolsSupported: number;
  readonly countedComments: number;
  /** Position in the global idol ranking, when this profile has fans. */
  readonly idolRank: number | null;
  /** Deeds this @ holds now. One was minted; the rest were bought. */
  readonly homesOwned: number;
  readonly mintedPlotIndex: number | null;
  readonly properties: readonly PropertyDto[];
  readonly listings: readonly ListingDto[];
  readonly offersReceived: readonly OfferDto[];
  readonly offersMade: readonly OfferDto[];
}

export interface AuthChallengeDto {
  readonly handle: string;
  /** Comment this on any post of the official account. */
  readonly code: string;
  readonly expiresAtIso: string;
  readonly officialHandle: string;
  /** Demo only: the server can play the comment for you. */
  readonly canSimulate: boolean;
}

export interface AuthStatusDto {
  readonly state: 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'NONE';
  readonly handle: string | null;
}

export interface StandingDto {
  readonly fandomHandle: string;
  readonly displayName: string;
  readonly category: FandomCategory;
  readonly neonColorHex: string;
  readonly fans: number;
  /** Reputation the fans earned for this idol. */
  readonly reputationXp: number;
  /** Where the idol's property stands, in metres. */
  readonly districtX: number;
  readonly districtZ: number;
  readonly footprint: PropertyFootprint;
  readonly propertyClass: PropertyClass;
  readonly city: CityId;
  /** Position in the single global ranking. */
  readonly rankPosition: number;
  readonly perks: {
    readonly specialDistrictLighting: boolean;
    readonly monument3D: boolean;
    readonly holographicBillboard: boolean;
  };
  /** Versus the ranking one momentum window ago. */
  readonly movement: {
    readonly rankDelta: number;
    readonly scoreDeltaPct: number | null;
    readonly isNew: boolean;
  };
}

export interface RankChangeDto {
  readonly atIso: string;
  readonly fandomHandle: string;
  readonly displayName: string;
  readonly neonColorHex: string;
  readonly fromRank: number;
  readonly toRank: number;
}

/** A person in the user rankings (by XP or by $FANT). */
export interface UserRankDto {
  readonly handle: string;
  readonly reputationXp: number;
  readonly level: number;
  /** 0..1 towards the next level. */
  readonly levelProgress: number;
  readonly tokenBalanceMicro: string;
  readonly fans: number;
  readonly propertyClass: PropertyClass | null;
  readonly fandomHandle: string | null;
}

export interface ListingDto {
  readonly listingId: string;
  readonly sellerHandle: string;
  readonly assetType: ListingAssetType;
  readonly plotIndex: number | null;
  readonly tokenAmountMicro: string | null;
  readonly priceBrlCents: string;
  readonly priceUsdtMicro: string;
  readonly priceBtcSats: string;
  readonly status: ListingStatus;
  readonly lock: { readonly buyerHandle: string; readonly paymentMethod: PaymentMethod; readonly expiresAtIso: string } | null;
  readonly buyerHandle: string | null;
  readonly settledAtIso: string | null;
}

export type ActivityOutcome =
  | {
      readonly status: 'MINTED_NEW_LAND' | 'ENGAGEMENT_POINTS_ONLY';
      readonly plotIndex: number;
      readonly idolHandle: string;
      readonly idolFans: number;
      readonly newFan: boolean;
      readonly xpGained: number;
      /** $FANT the newcomer received from their joining pack (micro-units). */
      readonly tokensGrantedMicro: string | null;
    }
  | { readonly status: 'REJECTED'; readonly code: CommentRejectionCode };

export interface ActivityEntryDto {
  readonly commentId: string;
  readonly atIso: string;
  readonly source: CommentSourceName;
  readonly authorUsername: string;
  readonly text: string;
  readonly mediaId: string;
  readonly outcome: ActivityOutcome;
}

export interface CitySummaryDto {
  readonly id: CityId;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly colorHex: string;
  readonly properties: number;
}

/** One ~500 m square of the world, for the planet view and chunk streaming. */
export interface ChunkSummaryDto {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  readonly count: number;
  readonly colorHex: string;
}

export interface WorldSummaryDto {
  readonly version: number;
  readonly generatedAtIso: string;
  readonly totals: {
    readonly properties: number;
    readonly idols: number;
    readonly activeFans: number;
    readonly commentsProcessed: number;
  };
  /** Top of the global idol ranking. */
  readonly standings: readonly StandingDto[];
  readonly rankChanges: readonly RankChangeDto[];
  readonly topByXp: readonly UserRankDto[];
  readonly topByTokens: readonly UserRankDto[];
  readonly listings: readonly ListingDto[];
  readonly activity: readonly ActivityEntryDto[];
  readonly cities: readonly CitySummaryDto[];
  readonly chunks: readonly ChunkSummaryDto[];
  /** The planet grows with the population, so the cities always fit on it. */
  readonly planetRadius: number;
  readonly tokenomics: TokenomicsDto;
}

/** $FANT, live (A11): where every unit came from and what the next newcomer gets. */
export interface TokenomicsDto {
  readonly symbol: 'FANT';
  readonly maxSupplyMicro: string;
  readonly mintedMicro: string;
  readonly buckets: readonly {
    readonly bucket: AllocationBucket;
    readonly bps: number;
    readonly capMicro: string;
    readonly emittedMicro: string;
    /** Locked buckets are never emitted by the game. */
    readonly locked: boolean;
  }[];
  readonly fanMint: {
    readonly members: number;
    readonly era: number;
    readonly packMicro: string;
    readonly nextEraAtMember: number | null;
    readonly idolRoyaltyBps: number;
  };
  readonly seasons: {
    readonly current: number | null;
    readonly nextPrizeMicro: string;
    readonly last: { readonly season: number; readonly prizeMicro: string; readonly paidMicro: string; readonly top: readonly { readonly handle: string; readonly micro: string }[] } | null;
  };
}

export interface WorldChunksDto {
  readonly version: number;
  readonly chunks: readonly { readonly key: string; readonly properties: readonly PropertyDto[] }[];
}

export interface WorldChangesDto {
  readonly version: number;
  /** True when `since` is too old for the change feed: reload what you show. */
  readonly reset: boolean;
  readonly properties: readonly PropertyDto[];
}

export interface PublicConfigDto {
  readonly brand: { readonly name: string; readonly domain: string };
  readonly demo: boolean;
  readonly commentSource: 'instagram' | 'simulated' | 'off';
  readonly pollIntervalSeconds: number;
  readonly momentumWindowSeconds: number;
  /** Profile pictures are served from /api/v1/avatars/:handle. */
  readonly avatars: boolean;
  readonly paymentRails: Readonly<Record<PaymentMethod, boolean>>;
}

export interface CheckoutResponseDto {
  readonly listingId: string;
  readonly paymentMethod: PaymentMethod;
  readonly amountInteger: string;
  readonly expiresAtIso: string;
  readonly pix: { readonly copiaECola: string; readonly demoKey: boolean } | null;
  readonly crypto: { readonly network: string; readonly address: string; readonly memo: string } | null;
}

/** A live ad as the game draws it (text and colours only). Contact details never leave the server. */
export interface AdDto {
  readonly id: string;
  readonly placement: AdPlacement;
  readonly city: AdCity;
  readonly headline: string;
  readonly tagline: string;
  readonly partnerHandle: string;
  readonly backgroundHex: string;
  readonly accentHex: string;
  /** Fanation's own "advertise here" inventory. */
  readonly house: boolean;
}

export interface AdsDto {
  readonly rateCard: readonly { readonly placement: AdPlacement; readonly centsPerDay: string }[];
  readonly campaigns: readonly AdDto[];
}

export interface AdRequestReceiptDto {
  readonly id: string;
  readonly status: AdStatus;
  readonly placement: AdPlacement;
  readonly days: number;
  readonly quoteBrlCents: string;
}

export interface ApiErrorDto {
  readonly error: string;
  readonly code: string;
}
