/**
 * Ranking momentum: how each fandom moved against a past sample of the
 * global ranking (positions gained, XP change in %) and which fandoms just
 * climbed. Pure functions; the clock is always passed in.
 */

import { FandomClubStats } from './types.js';

export interface RankSample {
  readonly atMs: number;
  readonly entries: ReadonlyMap<string, { readonly rank: number; readonly xp: number }>;
}

export interface FandomMovement {
  /** Positive = climbed that many places. */
  readonly rankDelta: number;
  /** XP change in percent with 2 decimals; null when there is no base to compare. */
  readonly scoreDeltaPct: number | null;
  /** Not in the ranking at the baseline. */
  readonly isNew: boolean;
}

export interface RankChange {
  readonly atMs: number;
  readonly fandomHandle: string;
  readonly fromRank: number;
  readonly toRank: number;
}

export function sampleStandings(atMs: number, standings: readonly FandomClubStats[]): RankSample {
  return {
    atMs,
    entries: new Map(standings.map((s) => [s.fandomHandle, { rank: s.rankPosition, xp: s.reputationXp }])),
  };
}

export function movementAgainst(baseline: RankSample | null, standing: FandomClubStats): FandomMovement {
  if (baseline === null) {
    return { rankDelta: 0, scoreDeltaPct: null, isNew: false };
  }
  const before = baseline.entries.get(standing.fandomHandle);
  if (!before) {
    return { rankDelta: 0, scoreDeltaPct: null, isNew: true };
  }
  const scoreDeltaPct =
    before.xp > 0 ? Math.round(((standing.reputationXp - before.xp) * 10_000) / before.xp) / 100 : null;
  return { rankDelta: before.rank - standing.rankPosition, scoreDeltaPct, isNew: false };
}

/** Fandoms that moved up between two consecutive samples (newcomers only when they enter the top `entryTopN`). */
export function climbsBetween(previous: RankSample, next: RankSample, entryTopN = 10): RankChange[] {
  const climbs: RankChange[] = [];
  for (const [handle, now] of next.entries) {
    const before = previous.entries.get(handle);
    if (before ? now.rank < before.rank : now.rank <= entryTopN) {
      climbs.push({ atMs: next.atMs, fandomHandle: handle, fromRank: before?.rank ?? previous.entries.size + 1, toRank: now.rank });
    }
  }
  return climbs.sort((a, b) => a.toRank - b.toRank);
}
