/**
 * Reputation (XP): earned by a profile for taking part, never bought, sold or
 * transferred. $FANT is the tradable balance; XP is who you are.
 */

export const MINT_XP = 100;
export const ENGAGEMENT_XP = 10;

/** Level n starts at 50·n·(n+1) − 100 XP: L1 0 · L2 200 · L3 500 · L4 900 · L5 1,400 … */
export function xpForLevel(level: number): number {
  return level <= 1 ? 0 : 50 * level * (level + 1) - 100;
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) {
    level += 1;
  }
  return level;
}

/** 0..1 progress from the current level to the next. */
export function levelProgress(xp: number): number {
  const level = levelForXp(xp);
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  return (xp - from) / (to - from);
}
