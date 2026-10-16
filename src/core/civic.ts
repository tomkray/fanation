/**
 * World fabric (Axiom A3). Civic venues have no owner, no mint and no deed.
 * They stand only on the plazas the grid already reserved inside each city —
 * never on the grand avenues. The avenues stay open road.
 */

import { CITY_SITES, CityId, citySite } from './cities.js';
import { blockOf } from './cityLayout.js';

export type CivicKind = 'CAPITAL' | 'ARENA' | 'STADIUM' | 'STUDIO' | 'HALL';

export interface CivicSite {
  readonly kind: CivicKind;
  readonly bx: number;
  readonly bz: number;
  readonly city: CityId;
}

export function isAvenueBlock(bx: number, bz: number): boolean {
  return bx === 0 || bz === 0;
}

/** The reserved plaza of a city, in block coordinates. */
export function plazaBlockOf(city: CityId): { readonly bx: number; readonly bz: number } {
  const site = citySite(city);
  return { bx: blockOf(site.centerQ), bz: blockOf(site.centerR) };
}

export function venueKindForCity(city: CityId): CivicKind {
  switch (city) {
    case 'MUSIC':
      return 'ARENA';
    case 'SPORTS':
      return 'STADIUM';
    case 'CREATORS':
      return 'STUDIO';
    case 'COMMUNITY':
      return 'HALL';
    case 'CAPITAL':
      return 'CAPITAL';
    default: {
      const exhaustive: never = city;
      throw new Error(`Unknown city ${String(exhaustive)}`);
    }
  }
}

/**
 * Civic landmarks inside an inhabited box. Only the reserved city plazas —
 * the avenues are road and never receive a venue or a bridge.
 */
export function civicLandmarksInBounds(minBx: number, maxBx: number, minBz: number, maxBz: number): CivicSite[] {
  const loX = Math.min(minBx, maxBx);
  const hiX = Math.max(minBx, maxBx);
  const loZ = Math.min(minBz, maxBz);
  const hiZ = Math.max(minBz, maxBz);
  const sites: CivicSite[] = [];
  for (const site of CITY_SITES) {
    const { bx, bz } = plazaBlockOf(site.id);
    if (bx < loX || bx > hiX || bz < loZ || bz > hiZ || isAvenueBlock(bx, bz)) {
      continue;
    }
    sites.push({ kind: venueKindForCity(site.id), bx, bz, city: site.id });
  }
  return sites;
}
