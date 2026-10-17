/**
 * The planet (Axiom A3). Two grand avenues cross at Genesis — a sacred empty
 * disc — and the single city expands outward forever on one golden spiral.
 * Fandom category (artist, club, …) colours and filters the ranking; it never
 * chooses a territory. Fans always live next to their idol.
 */

import { FandomCategory } from './types.js';

/** The one placeable city: rings around Genesis. */
export type CityId = 'GENESIS';

export interface CitySite {
  readonly id: CityId;
  readonly name: string;
  /** Lot coordinates of the planet centre (Genesis plaza). */
  readonly centerQ: number;
  readonly centerR: number;
  readonly colorHex: string;
}

export const CITY_SITES: readonly CitySite[] = [
  { id: 'GENESIS', name: 'Genesis', centerQ: 0, centerR: 0, colorHex: '#3AD6FF' },
];

const siteById = new Map(CITY_SITES.map((s) => [s.id, s]));

export function citySite(id: CityId): CitySite {
  const site = siteById.get(id);
  if (!site) {
    throw new Error(`Unknown city ${id}`);
  }
  return site;
}

/**
 * Category is a filter and a colour, never a map region. Every idol anchors
 * on the Genesis spiral.
 */
export function cityForCategory(_category: FandomCategory): CityId {
  return 'GENESIS';
}
