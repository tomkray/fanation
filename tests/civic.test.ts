/**
 * World fabric (A3): Genesis plaza stays sacred; cultural venues sit on the
 * spiral outside the avenues and grow with the population pulse.
 */

import { describe, expect, it } from 'vitest';
import {
  civicGrowthForFans,
  civicLandmarksInBounds,
  civicVenueLotCentres,
  civicVenueSites,
  isAvenueBlock,
  plazaBlockOf,
} from '../src/core/civic.js';
import { createCityLayout, placeIdolAnchor, territoryOf } from '../src/core/cityLayout.js';

const pulse = {
  properties: 40,
  artistFans: 120,
  sportsFans: 80,
  creatorFans: 40,
  communityFans: 200,
};

describe('world fabric (A3 civic)', () => {
  it('keeps the two grand avenues as ownerless road', () => {
    expect(isAvenueBlock(0, 0)).toBe(true);
    expect(isAvenueBlock(0, 12)).toBe(true);
    expect(isAvenueBlock(-9, 0)).toBe(true);
    expect(isAvenueBlock(12, -12)).toBe(false);
  });

  it('keeps Genesis as the sacred plaza at the crossing', () => {
    expect(plazaBlockOf('GENESIS')).toEqual({ bx: 0, bz: 0 });
    expect(isAvenueBlock(0, 0)).toBe(true);
  });

  it('plants four cultural venues off the avenues, on Genesis territory', () => {
    const sites = civicVenueSites(pulse);
    expect(sites.map((s) => s.kind)).toEqual(['ARENA', 'STADIUM', 'STUDIO', 'HALL']);
    expect(sites.every((s) => !isAvenueBlock(s.bx, s.bz))).toBe(true);
    expect(sites.every((s) => s.city === 'GENESIS')).toBe(true);
    expect(sites.every((s) => s.growth > 0 && s.growth <= 1)).toBe(true);
    for (const site of sites) {
      expect(territoryOf(site.gridQ, site.gridR)).toBe('GENESIS');
    }
  });

  it('reserves venue blocks in the layout so homes never claim them', () => {
    const layout = createCityLayout();
    const reserved = new Set(civicVenueLotCentres().map((c) => `${c.gridQ}:${c.gridR}`));
    for (let i = 0; i < 40; i += 1) {
      const cell = placeIdolAnchor(layout, 'GENESIS', 'BLOCK', `idol_${i}`);
      expect(reserved.has(`${cell.gridQ}:${cell.gridR}`)).toBe(false);
    }
  });

  it('scales growth with fans and hides venues on an empty planet', () => {
    expect(civicGrowthForFans(0, 0)).toBe(0);
    expect(civicGrowthForFans(0, 7)).toBeGreaterThan(0);
    expect(civicGrowthForFans(10_000, 7)).toBeGreaterThan(civicGrowthForFans(10, 7));
    expect(civicGrowthForFans(1_000_000, 7)).toBeLessThanOrEqual(1);
  });

  it('lists only venues inside the asked box', () => {
    const all = civicVenueSites(pulse);
    const box = civicLandmarksInBounds(-40, 40, -40, 40, pulse);
    expect(box.length).toBe(all.length);
    expect(civicLandmarksInBounds(1000, 1001, 1000, 1001, pulse)).toEqual([]);
  });
});
