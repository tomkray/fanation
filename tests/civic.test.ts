/**
 * World fabric (A3): Genesis plaza sits on the avenue crossing (drawn by the
 * engine). The grand avenues stay empty road; no venue is minted there.
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
    expect(sites).toEqual([]);
    expect(civicLandmarksInBounds(-40, 40, -40, 40)).toEqual(sites);
  });

  it('keeps Genesis as the plaza kit, not a home-block venue', () => {
    expect(plazaBlockOf('GENESIS')).toEqual({ bx: 0, bz: 0 });
    expect(venueKindForCity('GENESIS')).toBe('GENESIS');
    expect(isAvenueBlock(0, 0)).toBe(true);
  });
});
