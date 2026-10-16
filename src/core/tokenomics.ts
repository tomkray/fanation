/**
 * $FANT tokenomics (Axiom A11). Hard cap 100,000,000 FANT (6 decimals). Every
 * unit is either emitted by play — joining the planet or earning reputation —
 * or sits in a locked bucket; nothing is minted by hand.
 *
 * Allocation
 *   60%  Fan Mint      — a pack for every new member, halving in eras
 *   15%  Seasons       — paid each season by reputation earned (XP), never by money
 *   10%  Liquidity     — locked for marketplace liquidity
 *   10%  Treasury      — locked, 48-month vesting with a 12-month cliff
 *    5%  Ecosystem     — locked, partner and creator grants
 *
 * Game theory
 * - One pack per Instagram account, ever: the cost of a fake member is a real
 *   account plus a comment Meta delivers, and that cost rises as packs halve.
 * - 10% of each pack goes to the idol the newcomer named. It does not change
 *   what a fake account earns (the pack is split, not enlarged), but it pays
 *   idols for bringing real fans — anyone can be an idol.
 * - Seasons pay in proportion to XP earned that season. XP is capped per post
 *   and per day by the engagement rules, so a single account cannot farm it,
 *   and payouts are linear (splitting into many accounts earns nothing extra).
 *   No account takes more than 2% of a season's prize.
 * - Each season pays 1% of what is left in its pool, so the flow never ends
 *   abruptly and early seasons cannot drain it.
 */

export const FANT_DECIMALS = 6;
export const MICRO_PER_FANT = 1_000_000n;
export const MAX_SUPPLY_MICRO = 100_000_000n * MICRO_PER_FANT;

export type AllocationBucket = 'FAN_MINT' | 'SEASONS' | 'LIQUIDITY' | 'TREASURY' | 'ECOSYSTEM';

/** Basis points of the max supply; they sum to 10,000. */
export const ALLOCATION_BPS: Readonly<Record<AllocationBucket, bigint>> = {
  FAN_MINT: 6_000n,
  SEASONS: 1_500n,
  LIQUIDITY: 1_000n,
  TREASURY: 1_000n,
  ECOSYSTEM: 500n,
};

export function bucketCapMicro(bucket: AllocationBucket): bigint {
  return (MAX_SUPPLY_MICRO * ALLOCATION_BPS[bucket]) / 10_000n;
}

/** Era 0 pays 1,000 FANT to each of the first 3,000 members; every era doubles in length and halves the pack. */
export const FIRST_PACK_MICRO = 1_000n * MICRO_PER_FANT;
export const FIRST_ERA_MEMBERS = 3_000;
/**
 * 20 eras × 3M FANT = the 60M Fan Mint bucket; after that newcomers get their home only.
 * Halving in whole micro-units truncates from era 10 on, so ~1,490 FANT of rounding dust is never minted.
 */
export const MINT_ERAS = 20;
/** Share of each pack that goes to the idol the newcomer named. */
export const IDOL_ROYALTY_BPS = 1_000n;

export const SEASON_PAYOUT_BPS = 100n;
export const SEASON_MAX_SHARE_BPS = 200n;
/** Of each season's prize: fans by their own XP, idols by the XP their fans earned for them. */
export const SEASON_FANS_BPS = 7_000n;

export interface MintEra {
  readonly era: number;
  readonly packMicro: bigint;
  /** Member number (0-based) where this era starts and the next one does. */
  readonly startsAtMember: number;
  readonly nextEraAtMember: number | null;
}

/** Which era the n-th new member (0-based) falls in, and the pack it earns. */
export function mintEraFor(memberIndex: number): MintEra {
  let start = 0;
  for (let era = 0; era < MINT_ERAS; era += 1) {
    const length = FIRST_ERA_MEMBERS * 2 ** era;
    if (memberIndex < start + length) {
      return { era, packMicro: FIRST_PACK_MICRO >> BigInt(era), startsAtMember: start, nextEraAtMember: start + length };
    }
    start += length;
  }
  return { era: MINT_ERAS, packMicro: 0n, startsAtMember: start, nextEraAtMember: null };
}

export interface PackSplit {
  readonly memberMicro: bigint;
  readonly idolMicro: bigint;
}

/** The pack, clamped to what is left in the Fan Mint bucket, split between the newcomer and their idol. */
export function splitPack(memberIndex: number, fanMintedMicro: bigint): PackSplit {
  const remaining = bucketCapMicro('FAN_MINT') - fanMintedMicro;
  const scheduled = mintEraFor(memberIndex).packMicro;
  const pack = remaining <= 0n ? 0n : scheduled < remaining ? scheduled : remaining;
  const idolMicro = (pack * IDOL_ROYALTY_BPS) / 10_000n;
  return { memberMicro: pack - idolMicro, idolMicro };
}

/** One season's prize: a fixed share of what is still in the Seasons bucket. */
export function seasonPrizeMicro(seasonPaidMicro: bigint): bigint {
  const remaining = bucketCapMicro('SEASONS') - seasonPaidMicro;
  return remaining <= 0n ? 0n : (remaining * SEASON_PAYOUT_BPS) / 10_000n;
}

/**
 * Pays `pool` in proportion to `weights` (integer floor), capping any single
 * handle at SEASON_MAX_SHARE_BPS of the pool. Whatever rounding or caps leave
 * over is returned, never minted. Ties break by handle for determinism.
 */
export function distributeByWeight(pool: bigint, weights: ReadonlyMap<string, number>): { readonly payouts: Map<string, bigint>; readonly paidMicro: bigint } {
  const payouts = new Map<string, bigint>();
  const entries = [...weights.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = entries.reduce((sum, [, w]) => sum + BigInt(w), 0n);
  if (pool <= 0n || total === 0n) {
    return { payouts, paidMicro: 0n };
  }
  const cap = (pool * SEASON_MAX_SHARE_BPS) / 10_000n;
  let paid = 0n;
  for (const [handle, weight] of entries) {
    const share = (pool * BigInt(weight)) / total;
    const capped = share > cap ? cap : share;
    if (capped > 0n) {
      payouts.set(handle, capped);
      paid += capped;
    }
  }
  return { payouts, paidMicro: paid };
}
