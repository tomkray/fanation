/**
 * Catalogued fandoms shown with curated names, categories and colours.
 * Category is a filter and neon only (Axiom A3) — every idol still anchors on
 * the Genesis spiral. Any other handle fans mention competes as `UNLISTED`.
 */

import { FandomMetadata } from './types.js';

export const NEON_PALETTE: readonly string[] = [
  '#FF453A',
  '#FF9F0A',
  '#FFD60A',
  '#30D158',
  '#66D4CF',
  '#40C8E0',
  '#64D2FF',
  '#0A84FF',
  '#5E5CE6',
  '#BF5AF2',
  '#FF375F',
  '#F5F5F7',
];

export const FEATURED_FANDOMS: readonly FandomMetadata[] = [
  { fandomHandle: 'taylorswift', displayName: 'Taylor Swift', category: 'ARTIST', neonColorHex: '#5E5CE6' },
  { fandomHandle: 'bts.bighitofficial', displayName: 'BTS', category: 'ARTIST', neonColorHex: '#BF5AF2' },
  { fandomHandle: 'badbunnypr', displayName: 'Bad Bunny', category: 'ARTIST', neonColorHex: '#FFD60A' },
  { fandomHandle: 'beyonce', displayName: 'Beyoncé', category: 'ARTIST', neonColorHex: '#FF9F0A' },
  { fandomHandle: 'blackpinkofficial', displayName: 'BLACKPINK', category: 'ARTIST', neonColorHex: '#FF375F' },
  { fandomHandle: 'realmadrid', displayName: 'Real Madrid', category: 'CLUB', neonColorHex: '#F5F5F7' },
  { fandomHandle: 'fcbarcelona', displayName: 'FC Barcelona', category: 'CLUB', neonColorHex: '#0A84FF' },
  { fandomHandle: 'manchesterunited', displayName: 'Manchester United', category: 'CLUB', neonColorHex: '#FF453A' },
  { fandomHandle: 'mrbeast', displayName: 'MrBeast', category: 'INFLUENCER', neonColorHex: '#40C8E0' },
  { fandomHandle: 'khaby00', displayName: 'Khaby Lame', category: 'INFLUENCER', neonColorHex: '#30D158' },
  { fandomHandle: 'cristiano', displayName: 'Cristiano Ronaldo', category: 'ATHLETE', neonColorHex: '#66D4CF' },
  { fandomHandle: 'leomessi', displayName: 'Lionel Messi', category: 'ATHLETE', neonColorHex: '#64D2FF' },
];

const featuredByHandle = new Map(FEATURED_FANDOMS.map((f) => [f.fandomHandle, f]));

export function isFeaturedFandom(fandomHandle: string): boolean {
  return featuredByHandle.has(fandomHandle);
}

/** FNV-1a: stable across restarts, so an unlisted fandom keeps its colour. */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function resolveFandomMetadata(fandomHandle: string): FandomMetadata {
  const featured = featuredByHandle.get(fandomHandle);
  if (featured) {
    return featured;
  }
  return {
    fandomHandle,
    displayName: `@${fandomHandle}`,
    category: 'UNLISTED',
    neonColorHex: NEON_PALETTE[fnv1a32(fandomHandle) % NEON_PALETTE.length],
  };
}
