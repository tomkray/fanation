/**
 * Global ranking: every handle that has fans — superstars and fans who became
 * idols alike — in one table, ordered by the reputation (XP) their fans
 * earned for them.
 */

import type { CityId } from './cities.js';
import type { PropertyClass, PropertyFootprint } from './property.js';
import { FandomClubStats, FandomMetadata, GridCoordinate } from './types.js';

export interface FandomStandingInput extends FandomMetadata {
  readonly fans: number;
  readonly reputationXp: number;
  readonly district: GridCoordinate;
  readonly footprint: PropertyFootprint;
  readonly propertyClass: PropertyClass;
  readonly city: CityId;
}

export const DISTRICT_LIGHTING_TOP_N = 10;
export const MONUMENT_TOP_N = 3;

/**
 * Ties: more fans, then handle (stable).
 * Perks: #1 light beam; top 3 medal rings; top 10 full-strength neon.
 */
export function computeChampionshipStandings(inputs: readonly FandomStandingInput[]): FandomClubStats[] {
  const sorted = [...inputs].sort(
    (a, b) => b.reputationXp - a.reputationXp || b.fans - a.fans || a.fandomHandle.localeCompare(b.fandomHandle)
  );
  return sorted.map((entry, idx) => {
    const rankPosition = idx + 1;
    return {
      ...entry,
      rankPosition,
      perks: {
        specialDistrictLighting: rankPosition <= DISTRICT_LIGHTING_TOP_N,
        monument3D: rankPosition <= MONUMENT_TOP_N,
        holographicBillboard: rankPosition === 1,
      },
    };
  });
}
