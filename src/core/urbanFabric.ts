/**
 * Urban fabric (Axiom A3) — how Genesis *looks* as it expands.
 *
 * Placement laws stay in cityLayout/settle. This module only names the rings
 * a growing city should show, in the spirit of the great urbanists: a sacred
 * civic centre (Niemeyer / City Beautiful), green belts between growth rings
 * (garden-city tradition), neighbourhood tissue, and a soft frontier where
 * geology meets the built edge. Topology is the spiral and the avenues;
 * biomes here are visual geology, never a second map.
 */

export type UrbanRing = 'CIVIC_CORE' | 'GARDEN_BELT' | 'NEIGHBOURHOOD' | 'FRONTIER';

/** Block-radius bands from Genesis (block index distance). */
const CIVIC_MAX = 3;
/** A full green ring every N blocks from Genesis (garden-city cadence). */
const GARDEN_EVERY = 7;
const NEIGHBOURHOOD_MAX = 28;

export interface RingLook {
  readonly ring: UrbanRing;
  /** Grass / park tint for empty lots in this ring. */
  readonly grassHex: string;
  /** Extra tree density on vacant lots (0 = sparse, 1 = park). */
  readonly canopy: number;
}

/**
 * Chebyshev distance in block space — the natural ring for a square grid
 * with a cross of avenues.
 */
export function blockRingRadius(bx: number, bz: number): number {
  return Math.max(Math.abs(bx), Math.abs(bz));
}

export function isGardenBelt(radius: number): boolean {
  if (radius <= CIVIC_MAX) {
    return false;
  }
  return radius % GARDEN_EVERY === 0;
}

/** Visual ring for a city block. Pure geometry — same answer on every client. */
export function urbanRingOf(bx: number, bz: number): UrbanRing {
  const radius = blockRingRadius(bx, bz);
  if (radius <= CIVIC_MAX) {
    return 'CIVIC_CORE';
  }
  if (isGardenBelt(radius)) {
    return 'GARDEN_BELT';
  }
  if (radius <= NEIGHBOURHOOD_MAX) {
    return 'NEIGHBOURHOOD';
  }
  return 'FRONTIER';
}

export function ringLook(bx: number, bz: number): RingLook {
  const ring = urbanRingOf(bx, bz);
  switch (ring) {
    case 'CIVIC_CORE':
      return { ring, grassHex: '#2f7a5c', canopy: 0.55 };
    case 'GARDEN_BELT':
      return { ring, grassHex: '#2a9a58', canopy: 1 };
    case 'NEIGHBOURHOOD':
      return { ring, grassHex: '#33985a', canopy: 0.35 };
    case 'FRONTIER':
      return { ring, grassHex: '#2a5540', canopy: 0.2 };
    default: {
      const exhaustive: never = ring;
      throw new Error(`Unknown urban ring ${String(exhaustive)}`);
    }
  }
}
