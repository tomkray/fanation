/**
 * World fabric (Axiom A3). Civic venues have no owner, no mint and no deed.
 * Genesis plaza at the avenue crossing stays sacred and empty. Four cultural
 * venues sit on reserved landmark blocks of the Genesis spiral — outside the
 * plaza, never on the road — and grow with the planet's population by category
 * (visual scale only; the ledger never records them).
 */

import { CityId } from './cities.js';
import { spiralCell } from './spiral.js';

export type CivicKind = 'ARENA' | 'STADIUM' | 'STUDIO' | 'HALL';

export interface CivicSite {
  readonly kind: CivicKind;
  readonly bx: number;
  readonly bz: number;
  readonly city: CityId;
  /** Lot-centre coordinates reserved in the layout so homes never land here. */
  readonly gridQ: number;
  readonly gridR: number;
  /** 0..1 visual growth from the live population pulse. */
  readonly growth: number;
  readonly colorHex: string;
}

/** Fans (and properties) that drive how tall each venue looks — never ownership. */
export interface CivicPulse {
  readonly properties: number;
  readonly artistFans: number;
  readonly sportsFans: number;
  readonly creatorFans: number;
  readonly communityFans: number;
}

const LOTS_PER_BLOCK = 3;
/** Same wide step as idol landmarks, so venues sit on the same spiral family. */
const VENUE_SPACING = 6;
/**
 * Spiral indices past the sacred disc, snapped off the avenues (verified:
 * none land on block row/col 0). Staggered around Genesis.
 */
const VENUE_SPIRAL_K: Readonly<Record<CivicKind, number>> = {
  ARENA: 6,
  STADIUM: 8,
  STUDIO: 10,
  HALL: 12,
};

const VENUE_COLOR: Readonly<Record<CivicKind, string>> = {
  ARENA: '#BF5AF2',
  STADIUM: '#30D158',
  STUDIO: '#FF9F0A',
  HALL: '#64D2FF',
};

const VENUE_ORDER: readonly CivicKind[] = ['ARENA', 'STADIUM', 'STUDIO', 'HALL'];

function blockOf(cell: number): number {
  return Math.floor((cell + 1) / LOTS_PER_BLOCK);
}

function snapToBlockCentre(cell: number): number {
  return LOTS_PER_BLOCK * Math.round(cell / LOTS_PER_BLOCK) || 0;
}

export function isAvenueBlock(bx: number, bz: number): boolean {
  return bx === 0 || bz === 0;
}

/** Genesis plaza — avenue crossing, never a venue. */
export function plazaBlockOf(_city: CityId): { readonly bx: number; readonly bz: number } {
  return { bx: 0, bz: 0 };
}

/** @deprecated City id no longer picks a venue; kept for call sites that still pass GENESIS. */
export function venueKindForCity(_city: CityId): CivicKind {
  return 'HALL';
}

function lotCentreFor(kind: CivicKind): { readonly gridQ: number; readonly gridR: number } {
  const point = spiralCell(VENUE_SPIRAL_K[kind], VENUE_SPACING, 0, 0);
  return { gridQ: snapToBlockCentre(point.q), gridR: snapToBlockCentre(point.r) };
}

/** Every civic lot centre (for layout reservation). Stable forever. */
export function civicVenueLotCentres(): readonly { readonly gridQ: number; readonly gridR: number }[] {
  return VENUE_ORDER.map((kind) => lotCentreFor(kind));
}

/**
 * Soft growth curve: venues are always faintly present once the planet has
 * homes, then rise with log10(fans) so early days look alive and megacities
 * still have headroom.
 */
export function civicGrowthForFans(fans: number, properties: number): number {
  if (properties <= 0) {
    return 0;
  }
  const seed = 0.28;
  if (fans <= 0) {
    return seed;
  }
  return Math.min(1, seed + Math.log10(1 + fans) / 4);
}

function fansForKind(kind: CivicKind, pulse: CivicPulse): number {
  switch (kind) {
    case 'ARENA':
      return pulse.artistFans;
    case 'STADIUM':
      return pulse.sportsFans;
    case 'STUDIO':
      return pulse.creatorFans;
    case 'HALL':
      return pulse.communityFans;
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown civic kind ${String(exhaustive)}`);
    }
  }
}

/** All four venues with live growth. Empty pulse → growth 0 (hidden). */
export function civicVenueSites(pulse: CivicPulse): readonly CivicSite[] {
  return VENUE_ORDER.map((kind) => {
    const lot = lotCentreFor(kind);
    const bx = blockOf(lot.gridQ);
    const bz = blockOf(lot.gridR);
    if (isAvenueBlock(bx, bz)) {
      throw new Error(`Civic ${kind} landed on an avenue at ${bx}:${bz}; spiral index is wrong.`);
    }
    return {
      kind,
      bx,
      bz,
      city: 'GENESIS' as const,
      gridQ: lot.gridQ,
      gridR: lot.gridR,
      growth: civicGrowthForFans(fansForKind(kind, pulse), pulse.properties),
      colorHex: VENUE_COLOR[kind],
    };
  });
}

/**
 * Civic landmarks inside an inhabited box. Genesis plaza is never listed
 * (engine draws it as the plaza kit). Venues with growth 0 stay out.
 */
export function civicLandmarksInBounds(
  minBx: number,
  maxBx: number,
  minBz: number,
  maxBz: number,
  pulse: CivicPulse = { properties: 1, artistFans: 0, sportsFans: 0, creatorFans: 0, communityFans: 0 }
): CivicSite[] {
  const loX = Math.min(minBx, maxBx);
  const hiX = Math.max(minBx, maxBx);
  const loZ = Math.min(minBz, maxBz);
  const hiZ = Math.max(minBz, maxBz);
  return civicVenueSites(pulse).filter(
    (site) => site.growth > 0 && site.bx >= loX && site.bx <= hiX && site.bz >= loZ && site.bz <= hiZ
  );
}
