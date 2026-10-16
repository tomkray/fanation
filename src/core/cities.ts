/**
 * The planet's cities (Axiom A3). Two grand avenues cross at the Capital and
 * split the plane into four quadrants; each quadrant is one city and extends
 * outward forever, so cities never run into each other however large they
 * grow. Catalogued idols found their district in the city of their category;
 * anyone else who is named as an idol before owning a home starts in
 * Community City. Fans always live in their idol's city, next to the idol.
 */

import { FandomCategory } from './types.js';

export type CityId = 'CAPITAL' | 'MUSIC' | 'SPORTS' | 'CREATORS' | 'COMMUNITY';

export type QuadrantSign = 1 | -1;

export interface CitySite {
  readonly id: CityId;
  readonly name: string;
  /** Block-centre lot coordinates (multiples of 3) where the city's spirals start. */
  readonly centerQ: number;
  readonly centerR: number;
  /** The quadrant the city owns; null for the Capital at the crossing. */
  readonly quadrant: { readonly q: QuadrantSign; readonly r: QuadrantSign } | null;
  readonly colorHex: string;
}

/** City centres sit 12 blocks out along each diagonal (~1 km from the Capital). */
const OFFSET = 36;

export const CITY_SITES: readonly CitySite[] = [
  { id: 'CAPITAL', name: 'Fanation Capital', centerQ: 0, centerR: 0, quadrant: null, colorHex: '#3AD6FF' },
  { id: 'MUSIC', name: 'Music City', centerQ: OFFSET, centerR: -OFFSET, quadrant: { q: 1, r: -1 }, colorHex: '#BF5AF2' },
  { id: 'SPORTS', name: 'Stadium City', centerQ: OFFSET, centerR: OFFSET, quadrant: { q: 1, r: 1 }, colorHex: '#30D158' },
  { id: 'CREATORS', name: 'Creator City', centerQ: -OFFSET, centerR: OFFSET, quadrant: { q: -1, r: 1 }, colorHex: '#FF9F0A' },
  { id: 'COMMUNITY', name: 'Community City', centerQ: -OFFSET, centerR: -OFFSET, quadrant: { q: -1, r: -1 }, colorHex: '#64D2FF' },
];

const siteById = new Map(CITY_SITES.map((s) => [s.id, s]));
const cityByQuadrant = new Map(
  CITY_SITES.flatMap((s) => (s.quadrant ? [[`${s.quadrant.q}:${s.quadrant.r}`, s.id] as const] : []))
);

export function citySite(id: CityId): CitySite {
  const site = siteById.get(id);
  if (!site) {
    throw new Error(`Unknown city ${id}`);
  }
  return site;
}

export function cityAtQuadrant(q: QuadrantSign, r: QuadrantSign): CityId {
  const id = cityByQuadrant.get(`${q}:${r}`);
  if (!id) {
    throw new Error(`No city owns quadrant ${q}:${r}`);
  }
  return id;
}

export function cityForCategory(category: FandomCategory): CityId {
  switch (category) {
    case 'ARTIST':
      return 'MUSIC';
    case 'CLUB':
    case 'ATHLETE':
      return 'SPORTS';
    case 'INFLUENCER':
      return 'CREATORS';
    case 'UNLISTED':
      return 'COMMUNITY';
    default: {
      const exhaustive: never = category;
      throw new Error(`Unknown category ${String(exhaustive)}`);
    }
  }
}
