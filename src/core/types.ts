/**
 * Core domain types for Não É Um Fã (naoeumfa).
 */

import type { CityId } from './cities.js';
import type { PropertyClass, PropertyFootprint } from './property.js';

/** `UNLISTED` = a handle fans mentioned that is not in the catalogue yet. */
export type FandomCategory = 'ARTIST' | 'CLUB' | 'INFLUENCER' | 'ATHLETE' | 'UNLISTED';

export type PaymentMethod = 'PIX' | 'USDT' | 'USDC' | 'BTC';

export type ListingAssetType = 'LAND_PLOT' | 'NEFA_PACK';

export type ListingStatus = 'OPEN' | 'LOCKED_ESCROW' | 'SETTLED' | 'CANCELLED';

/** A 16 m grid cell and its world position in metres. */
export interface GridCoordinate {
  readonly gridQ: number;
  readonly gridR: number;
  readonly x: number;
  readonly z: number;
}

/**
 * One comment exactly as the Meta `comments` webhook field can describe it.
 * Meta sends no follower count, account age or commenter IP, so anti-bot
 * rules may only rely on these fields.
 */
export interface InstagramCommentEvent {
  readonly commentId: string;
  readonly mediaId: string;
  readonly text: string;
  readonly authorUsername: string;
  readonly authorId: string | null;
  readonly receivedAtMs: number;
}

export interface ParsedCommentIntent {
  readonly commentId: string;
  readonly mediaId: string;
  readonly voterHandle: string;
  readonly fandomHandle: string;
  /** Other people tagged in the same comment (the idol, the author and the official account excluded). */
  readonly friendHandles: readonly string[];
}

/**
 * One *mint* per Instagram handle, forever (Axiom A1). It appears when the
 * person comments (a home next to their idol) or when someone names them as
 * an idol first (an anchor in their category's city). Ownership can move on
 * the market — a profile may hold many deeds. Class follows the minter's fans.
 */
export interface LandPlot {
  readonly plotIndex: number;
  /** The profile this property belongs to. Immutable primary key. */
  readonly minterHandle: string;
  /** Transferable through the marketplace. */
  readonly ownerHandle: string;
  /** District identity: the idol it was built next to, or itself for an anchor. */
  readonly fandomHandle: string;
  /** The idol it was built next to; null when it was placed as an idol anchor. */
  readonly idolHandle: string | null;
  readonly footprint: PropertyFootprint;
  readonly city: CityId;
  readonly coordinates: GridCoordinate;
  readonly sourceCommentId: string;
  readonly mintedAtIso: string;
}

export interface FandomMetadata {
  readonly fandomHandle: string;
  readonly displayName: string;
  readonly category: FandomCategory;
  readonly neonColorHex: string;
}

export interface FandomClubStats extends FandomMetadata {
  /** Unique people who named this handle as their idol. */
  readonly fans: number;
  /** Reputation the fans earned for this idol. */
  readonly reputationXp: number;
  /** Where the idol's own property stands. */
  readonly district: GridCoordinate;
  readonly footprint: PropertyFootprint;
  readonly propertyClass: PropertyClass;
  readonly city: CityId;
  /** One global ranking across every category. */
  readonly rankPosition: number;
  readonly perks: {
    readonly specialDistrictLighting: boolean;
    readonly monument3D: boolean;
    readonly holographicBillboard: boolean;
  };
}

export type CommentRejectionCode =
  | 'DUPLICATE_COMMENT_ID'
  | 'OWN_ACCOUNT_COMMENT'
  | 'RATE_LIMIT_EXCEEDED'
  | 'INVALID_COMMENT_FORMAT'
  | 'SELF_MINT_FORBIDDEN'
  | 'POST_ALREADY_COUNTED';

interface AcceptedComment {
  /** The commenting fan's property. */
  readonly land: LandPlot;
  /** The named idol's property. */
  readonly idol: LandPlot;
  readonly xpGained: number;
  /** First time this fan named this idol. */
  readonly newFan: boolean;
  readonly idolFans: number;
}

export type CommentProcessingOutcome =
  | (AcceptedComment & { readonly status: 'MINTED_NEW_LAND'; readonly tokensGrantedMicro: bigint })
  | (AcceptedComment & { readonly status: 'ENGAGEMENT_POINTS_ONLY'; readonly reason: string })
  | {
      readonly status: 'REJECTED';
      readonly code: CommentRejectionCode;
      readonly reason: string;
    };

export interface CheckoutLock {
  readonly buyerHandle: string;
  readonly paymentMethod: PaymentMethod;
  readonly checkoutRef: string;
  readonly lockedAtMs: number;
  readonly expiresAtMs: number;
}

export interface MarketListing {
  readonly listingId: string;
  readonly sellerHandle: string;
  readonly assetType: ListingAssetType;
  readonly plotIndex: number | null;
  readonly tokenAmountMicro: bigint | null;
  readonly priceBrlCents: bigint;
  readonly priceUsdtMicro: bigint;
  readonly priceBtcSats: bigint;
  readonly status: ListingStatus;
  readonly lock: CheckoutLock | null;
  readonly buyerHandle: string | null;
  readonly paymentMethod: PaymentMethod | null;
  readonly externalTxRef: string | null;
  readonly createdAtIso: string;
  readonly settledAtIso: string | null;
}
