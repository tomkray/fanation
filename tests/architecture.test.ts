/**
 * Architecture growth: fans raise a building to the style cap, then the
 * silhouette changes to a rarer family. Same plot, same variant inside a class.
 */

import { describe, expect, it } from 'vitest';
import { architectureOf, pickStyleIndex, visualClassFor } from '../src/core/architecture.js';
import { propertyClassFor, towerHeightMeters } from '../src/core/property.js';

describe('architecture growth (A4)', () => {
  it('walks the popular rarity ladder as fans cross each cap', () => {
    const steps = [0, 1, 5, 20, 100, 1_000, 10_000].map((fans) => architectureOf(7, fans, 'LOT'));
    expect(steps.map((a) => a.rarity)).toEqual(['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'APEX']);
    expect(steps.map((a) => a.visualClass)).toEqual(['COTTAGE', 'HOUSE', 'TOWNHOUSE', 'VILLA', 'TOWER', 'SKYSCRAPER', 'MEGATOWER']);
    expect(new Set(steps.map((a) => a.style.id)).size).toBe(7);
  });

  it('grows height inside a band and jumps style, not stretch, at the cap', () => {
    const villaLow = architectureOf(3, 20, 'LOT');
    const villaHigh = architectureOf(3, 99, 'LOT');
    const tower = architectureOf(3, 100, 'LOT');
    expect(villaLow.style.id).toBe(villaHigh.style.id);
    expect(villaHigh.heightMeters).toBeGreaterThan(villaLow.heightMeters);
    expect(villaHigh.heightMeters).toBeLessThanOrEqual(villaHigh.heightCeil + 0.01);
    expect(tower.style.id).not.toBe(villaHigh.style.id);
    expect(tower.rarity).toBe('LEGENDARY');
    expect(tower.heightMeters).toBeGreaterThan(villaHigh.heightMeters);
  });

  it('keeps the same variant for one plot inside a class, and differs across plots', () => {
    const a = architectureOf(4, 250, 'LOT');
    const again = architectureOf(4, 800, 'LOT');
    const other = architectureOf(5, 250, 'LOT');
    expect(a.style.id).toBe(again.style.id);
    expect(a.visualClass).toBe('TOWER');
    const picks = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((plot) => pickStyleIndex(plot, 3));
    expect(new Set(picks).size).toBeGreaterThan(1);
    expect(other.visualClass).toBe(a.visualClass);
  });

  it('a landmark block never drops below a tower, and still evolves to apex', () => {
    expect(visualClassFor(0, 'BLOCK')).toBe('TOWER');
    expect(visualClassFor(50, 'BLOCK')).toBe('TOWER');
    expect(visualClassFor(1_000, 'BLOCK')).toBe('SKYSCRAPER');
    expect(visualClassFor(10_000, 'BLOCK')).toBe('MEGATOWER');
    expect(propertyClassFor(3, 'BLOCK')).toBe('LANDMARK');
    const small = architectureOf(1, 3, 'BLOCK');
    const huge = architectureOf(1, 12_000, 'BLOCK');
    expect(small.propertyClass).toBe('LANDMARK');
    expect(small.visualClass).toBe('TOWER');
    expect(huge.visualClass).toBe('MEGATOWER');
    expect(huge.heightMeters).toBeGreaterThan(small.heightMeters);
  });

  it('height is identical for every style in the same band', () => {
    expect(towerHeightMeters(100, 'LOT')).toBe(architectureOf(0, 100, 'LOT').heightMeters);
    expect(towerHeightMeters(100, 'LOT')).toBe(architectureOf(99, 100, 'LOT').heightMeters);
  });
});
