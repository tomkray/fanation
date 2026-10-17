/**
 * Visual growth rings (A3): civic core, garden belts, neighbourhood, frontier.
 * Never changes deeds — only how empty lots look as the city expands.
 */

import { describe, expect, it } from 'vitest';
import { blockRingRadius, isGardenBelt, ringLook, urbanRingOf } from '../src/core/urbanFabric.js';

describe('urban fabric rings (A3)', () => {
  it('treats Genesis neighbourhood as civic core', () => {
    expect(urbanRingOf(0, 0)).toBe('CIVIC_CORE');
    expect(urbanRingOf(2, -1)).toBe('CIVIC_CORE');
    expect(blockRingRadius(5, -3)).toBe(5);
  });

  it('opens garden belts on a regular cadence past the core', () => {
    expect(isGardenBelt(2)).toBe(false);
    expect(isGardenBelt(7)).toBe(true);
    expect(isGardenBelt(14)).toBe(true);
    expect(isGardenBelt(8)).toBe(false);
    expect(urbanRingOf(7, 0)).toBe('GARDEN_BELT');
    expect(ringLook(7, 2).canopy).toBe(1);
  });

  it('softens the frontier far from Genesis', () => {
    expect(urbanRingOf(40, 12)).toBe('FRONTIER');
    expect(ringLook(40, 12).canopy).toBeLessThan(ringLook(10, 4).canopy);
  });
});
