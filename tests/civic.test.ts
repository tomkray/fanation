/**
 * World fabric (A3): civic venues sit on the reserved plazas inside each
 * city. The grand avenues stay empty road.
 */

import { describe, expect, it } from 'vitest';
import { civicLandmarksInBounds, isAvenueBlock, plazaBlockOf, venueKindForCity } from '../src/core/civic.js';

describe('world fabric (A3 civic)', () => {
  it('keeps the two grand avenues as ownerless road', () => {
    expect(isAvenueBlock(0, 0)).toBe(true);
    expect(isAvenueBlock(0, 12)).toBe(true);
    expect(isAvenueBlock(-9, 0)).toBe(true);
    expect(isAvenueBlock(12, -12)).toBe(false);
  });

  it('never places a venue or a bridge on the avenue', () => {
    const sites = civicLandmarksInBounds(-40, 40, -40, 40);
    expect(sites.every((s) => !isAvenueBlock(s.bx, s.bz))).toBe(true);
    expect(sites.some((s) => s.kind === 'STADIUM')).toBe(true);
    expect(sites.some((s) => s.kind === 'ARENA')).toBe(true);
    expect(civicLandmarksInBounds(-40, 40, -40, 40)).toEqual(sites);
  });

  it('places one venue on each city plaza, never on a home block', () => {
    const sites = civicLandmarksInBounds(-20, 20, -20, 20);
    expect(sites.map((s) => s.city).sort()).toEqual(['COMMUNITY', 'CREATORS', 'MUSIC', 'SPORTS']);
    for (const plaza of sites) {
      expect(plazaBlockOf(plaza.city)).toEqual({ bx: plaza.bx, bz: plaza.bz });
      expect(plaza.kind).toBe(venueKindForCity(plaza.city));
    }
  });
});
