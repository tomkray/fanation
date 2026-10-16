/**
 * Architecture growth (Axiom A4). Fans raise a building to the height cap
 * of its current style; crossing the next fan mark retires that silhouette
 * and replaces it with a rarer one. The same plot always keeps the same
 * variant inside a class (so the city never reshuffles), and a class change
 * always changes the family — Common cottage → Apex megatower.
 *
 * Height stays inside the class band. The jump at the threshold is the
 * style change, not another stretch of the same tower.
 */

import { fansForNextClass, PropertyClass, PropertyFootprint, propertyClassFor, towerHeightMeters } from './property.js';

export type ArchitectureRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC' | 'APEX';

export type VisualClass = Exclude<PropertyClass, 'LANDMARK'>;

export type ArchitectureStyleId =
  | 'cottage_gable'
  | 'cottage_round'
  | 'house_suburban'
  | 'house_l'
  | 'townhouse_corner'
  | 'townhouse_shop'
  | 'villa_terrace'
  | 'villa_pool'
  | 'tower_square'
  | 'tower_round'
  | 'tower_slab'
  | 'sky_needle'
  | 'sky_deco'
  | 'sky_glass'
  | 'mega_spire'
  | 'mega_twist'
  | 'mega_crown';

export interface ArchitectureStyle {
  readonly id: ArchitectureStyleId;
  readonly name: string;
  readonly file: string;
  /** Horizontal scale of the lot tower (1 = the 30 m landmark shaft). */
  readonly lotScale: number;
}

export interface ArchitectureBand {
  readonly visualClass: VisualClass;
  readonly rarity: ArchitectureRarity;
  readonly minFans: number;
  /** Exclusive. Null = the top of the ladder. */
  readonly nextAt: number | null;
  readonly heightFloor: number;
  readonly heightCeil: number;
  readonly styles: readonly ArchitectureStyle[];
}

export interface Architecture {
  readonly propertyClass: PropertyClass;
  readonly visualClass: VisualClass;
  readonly rarity: ArchitectureRarity;
  readonly style: ArchitectureStyle;
  readonly heightMeters: number;
  readonly heightFloor: number;
  readonly heightCeil: number;
  /** 0 at the class floor, 1 at the class cap (or at the top of the ladder). */
  readonly progress: number;
  readonly nextClassAtFans: number | null;
}

const STYLES = {
  cottage_gable: { id: 'cottage_gable', name: 'Gable cottage', file: 'tier_4_common.glb', lotScale: 1 },
  cottage_round: { id: 'cottage_round', name: 'Round cottage', file: 'home_cottage_round.glb', lotScale: 1 },
  house_suburban: { id: 'house_suburban', name: 'Suburban house', file: 'tier_3_uncommon.glb', lotScale: 1 },
  house_l: { id: 'house_l', name: 'L-wing house', file: 'home_house_l.glb', lotScale: 1 },
  townhouse_corner: { id: 'townhouse_corner', name: 'Corner townhouse', file: 'tier_2_rare.glb', lotScale: 1 },
  townhouse_shop: { id: 'townhouse_shop', name: 'Shop townhouse', file: 'home_townhouse_shop.glb', lotScale: 1 },
  villa_terrace: { id: 'villa_terrace', name: 'Terrace villa', file: 'tier_1_epic.glb', lotScale: 1 },
  villa_pool: { id: 'villa_pool', name: 'Pool villa', file: 'home_villa_pool.glb', lotScale: 1 },
  tower_square: { id: 'tower_square', name: 'Square tower', file: 'tower.glb', lotScale: 0.45 },
  tower_round: { id: 'tower_round', name: 'Round tower', file: 'tower_round.glb', lotScale: 0.42 },
  tower_slab: { id: 'tower_slab', name: 'Slab tower', file: 'tower_slab.glb', lotScale: 0.5 },
  sky_needle: { id: 'sky_needle', name: 'Needle skyscraper', file: 'tower_needle.glb', lotScale: 0.3 },
  sky_deco: { id: 'sky_deco', name: 'Deco skyscraper', file: 'tower_deco.glb', lotScale: 0.4 },
  sky_glass: { id: 'sky_glass', name: 'Glass skyscraper', file: 'tower_glass.glb', lotScale: 0.52 },
  mega_spire: { id: 'mega_spire', name: 'Spire megatower', file: 'tower_spire.glb', lotScale: 0.36 },
  mega_twist: { id: 'mega_twist', name: 'Twist megatower', file: 'tower_twist.glb', lotScale: 0.46 },
  mega_crown: { id: 'mega_crown', name: 'Crown megatower', file: 'tower_crown.glb', lotScale: 0.54 },
} as const satisfies Record<ArchitectureStyleId, ArchitectureStyle>;

/** If a rarer GLB is missing, the previous family's file still stands in. */
export const STYLE_FALLBACK_FILE: Readonly<Record<ArchitectureStyleId, string>> = {
  cottage_gable: 'tier_4_common.glb',
  cottage_round: 'home_cottage_round.glb',
  house_suburban: 'tier_3_uncommon.glb',
  house_l: 'home_house_l.glb',
  townhouse_corner: 'tier_2_rare.glb',
  townhouse_shop: 'home_townhouse_shop.glb',
  villa_terrace: 'tier_1_epic.glb',
  villa_pool: 'home_villa_pool.glb',
  tower_square: 'tower.glb',
  tower_round: 'tower_round.glb',
  tower_slab: 'tower_slab.glb',
  sky_needle: 'tower_round.glb',
  sky_deco: 'tower.glb',
  sky_glass: 'tower_slab.glb',
  mega_spire: 'tower_round.glb',
  mega_twist: 'tower_slab.glb',
  mega_crown: 'tower.glb',
};

export const ARCHITECTURE_LADDER: readonly ArchitectureBand[] = [
  {
    visualClass: 'COTTAGE',
    rarity: 'COMMON',
    minFans: 0,
    nextAt: 1,
    heightFloor: 6,
    heightCeil: 8,
    styles: [STYLES.cottage_gable, STYLES.cottage_round],
  },
  {
    visualClass: 'HOUSE',
    rarity: 'UNCOMMON',
    minFans: 1,
    nextAt: 5,
    heightFloor: 8,
    heightCeil: 12,
    styles: [STYLES.house_suburban, STYLES.house_l],
  },
  {
    visualClass: 'TOWNHOUSE',
    rarity: 'RARE',
    minFans: 5,
    nextAt: 20,
    heightFloor: 12,
    heightCeil: 16,
    styles: [STYLES.townhouse_corner, STYLES.townhouse_shop],
  },
  {
    visualClass: 'VILLA',
    rarity: 'EPIC',
    minFans: 20,
    nextAt: 100,
    heightFloor: 14,
    heightCeil: 22,
    styles: [STYLES.villa_terrace, STYLES.villa_pool],
  },
  {
    visualClass: 'TOWER',
    rarity: 'LEGENDARY',
    minFans: 100,
    nextAt: 1_000,
    heightFloor: 24,
    heightCeil: 80,
    styles: [STYLES.tower_square, STYLES.tower_round, STYLES.tower_slab],
  },
  {
    visualClass: 'SKYSCRAPER',
    rarity: 'MYTHIC',
    minFans: 1_000,
    nextAt: 10_000,
    heightFloor: 88,
    heightCeil: 180,
    styles: [STYLES.sky_needle, STYLES.sky_deco, STYLES.sky_glass],
  },
  {
    visualClass: 'MEGATOWER',
    rarity: 'APEX',
    minFans: 10_000,
    nextAt: null,
    heightFloor: 200,
    heightCeil: 420,
    styles: [STYLES.mega_spire, STYLES.mega_twist, STYLES.mega_crown],
  },
];

const bandByClass = new Map(ARCHITECTURE_LADDER.map((band) => [band.visualClass, band]));

/** A landmark block never drops below a tower: the plaza is too big for a cottage. */
export function visualClassFor(fans: number, footprint: PropertyFootprint): VisualClass {
  const grown = propertyClassFor(fans, 'LOT');
  if (grown === 'LANDMARK') {
    return 'MEGATOWER';
  }
  if (footprint === 'BLOCK' && (grown === 'COTTAGE' || grown === 'HOUSE' || grown === 'TOWNHOUSE' || grown === 'VILLA')) {
    return 'TOWER';
  }
  return grown;
}

export function architectureBand(visualClass: VisualClass): ArchitectureBand {
  const band = bandByClass.get(visualClass);
  if (!band) {
    throw new Error(`No architecture band for ${visualClass}`);
  }
  return band;
}

/** Stable pick inside a class: the same plot keeps the same variant forever. */
export function pickStyleIndex(plotIndex: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  let h = Math.imul(plotIndex ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 12)) >>> 0) % count;
}

function progressInBand(fans: number, band: ArchitectureBand): number {
  const span = band.nextAt === null ? 40_000 : band.nextAt - band.minFans;
  return Math.min(1, Math.max(0, (fans - band.minFans) / span));
}

/**
 * Everything the map and the deed need to draw one property. Derived from
 * plot number + fans + footprint, so a replay never needs to store it.
 */
export function architectureOf(plotIndex: number, fans: number, footprint: PropertyFootprint): Architecture {
  const propertyClass = propertyClassFor(fans, footprint);
  const visualClass = visualClassFor(fans, footprint);
  const band = architectureBand(visualClass);
  const style = band.styles[pickStyleIndex(plotIndex, band.styles.length)];
  const progress = progressInBand(Math.max(0, fans), band);
  return {
    propertyClass,
    visualClass,
    rarity: band.rarity,
    style,
    heightMeters: towerHeightMeters(fans, footprint),
    heightFloor: footprint === 'BLOCK' ? band.heightFloor * 1.45 : band.heightFloor,
    heightCeil: footprint === 'BLOCK' ? Math.min(640, band.heightCeil * 1.45) : band.heightCeil,
    progress,
    nextClassAtFans: fansForNextClass(fans, footprint),
  };
}

export function isTowerVisual(visualClass: VisualClass): boolean {
  return visualClass === 'TOWER' || visualClass === 'SKYSCRAPER' || visualClass === 'MEGATOWER';
}

export function styleScale(style: ArchitectureStyle, footprint: PropertyFootprint): number {
  return footprint === 'BLOCK' ? style.lotScale * 2.15 : style.lotScale;
}
