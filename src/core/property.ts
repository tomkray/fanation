/**
 * Property classes (Axiom A4): what a profile's building becomes as people
 * name it as their idol. The rule is the same for everyone: a fan who gains
 * fans grows exactly like a superstar does. Height and silhouette live in
 * `architecture.ts` — this file is the fan-threshold ladder only.
 */

export type PropertyFootprint = 'LOT' | 'BLOCK';

export type PropertyClass =
  | 'COTTAGE'
  | 'HOUSE'
  | 'TOWNHOUSE'
  | 'VILLA'
  | 'TOWER'
  | 'SKYSCRAPER'
  | 'MEGATOWER'
  | 'LANDMARK';

/** Highest threshold first. A block-sized landmark is reserved for catalogued idols. */
const LOT_CLASS_THRESHOLDS: readonly (readonly [PropertyClass, number])[] = [
  ['MEGATOWER', 10_000],
  ['SKYSCRAPER', 1_000],
  ['TOWER', 100],
  ['VILLA', 20],
  ['TOWNHOUSE', 5],
  ['HOUSE', 1],
  ['COTTAGE', 0],
];

export function propertyClassFor(fans: number, footprint: PropertyFootprint): PropertyClass {
  if (footprint === 'BLOCK') {
    return 'LANDMARK';
  }
  for (const [cls, min] of LOT_CLASS_THRESHOLDS) {
    if (fans >= min) {
      return cls;
    }
  }
  return 'COTTAGE';
}

/** Fans needed for the next class, or null at the top. */
export function fansForNextClass(fans: number, footprint: PropertyFootprint): number | null {
  if (footprint === 'BLOCK') {
    return null;
  }
  const next = [...LOT_CLASS_THRESHOLDS].reverse().find(([, min]) => min > fans);
  return next ? next[1] : null;
}

export function isTowerClass(cls: PropertyClass): boolean {
  return cls === 'TOWER' || cls === 'SKYSCRAPER' || cls === 'MEGATOWER' || cls === 'LANDMARK';
}

/**
 * Height of the building body in metres. Same bands as `architecture.ts`
 * (kept here so this file never imports architecture — architecture already
 * imports the class ladder). Crossing the next fan mark changes style, not
 * this formula's family.
 */
const HEIGHT_BANDS: readonly (readonly [number, number, number, number | null])[] = [
  // minFans, floor m, ceil m, nextAt
  [10_000, 200, 420, null],
  [1_000, 88, 180, 10_000],
  [100, 24, 80, 1_000],
  [20, 14, 22, 100],
  [5, 12, 16, 20],
  [1, 8, 12, 5],
  [0, 6, 8, 1],
];

export function towerHeightMeters(fans: number, footprint: PropertyFootprint): number {
  const f = Math.max(0, fans);
  const band = HEIGHT_BANDS.find(([min]) => f >= min) ?? HEIGHT_BANDS[HEIGHT_BANDS.length - 1];
  const [, floor, ceil, nextAt] = band;
  const span = nextAt === null ? 40_000 : nextAt - band[0];
  const raw = (f - band[0]) / span;
  const t = Math.sqrt(Math.min(1, Math.max(0, raw)));
  const lot = floor + (ceil - floor) * t;
  return footprint === 'BLOCK' ? Math.min(640, lot * 1.45) : lot;
}
