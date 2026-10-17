/**
 * Fanbase duels (Axiom A12). Two idols face off in a city's arena for a
 * limited time; the battleground is one Instagram post. A comment on that
 * post naming one of the two @s is a vote — one per Instagram account per
 * duel, only while the duel is live — and still counts as a normal comment
 * for the city. When the time is up, everyone who voted earns XP, the winning
 * side earns more, and the winning idol's fandom earns reputation. Votes come
 * only from comments Meta delivers, so a vote costs a real account.
 */

import type { CityId } from './cities.js';

export const DUEL_WIN_XP = 25;
export const DUEL_PLAY_XP = 5;
export const DUEL_FANDOM_XP_PER_VOTE = 5;
export const DUEL_MIN_MINUTES = 5;
export const DUEL_MAX_MINUTES = 7 * 24 * 60;

export type DuelArena = CityId;
export type DuelStatus = 'LIVE' | 'FINISHED';

export interface DuelSchedule {
  readonly duelId: string;
  readonly arena: DuelArena;
  readonly idolA: string;
  readonly idolB: string;
  /** The Instagram post where the votes are cast. */
  readonly mediaId: string;
  readonly postUrl: string | null;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
}

export interface Duel extends DuelSchedule {
  readonly votesA: number;
  readonly votesB: number;
  readonly status: DuelStatus;
  /** null while live, or on a draw. */
  readonly winner: string | null;
}

export class DuelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuelError';
  }
}

/** A schedule is checked as hostile input before it enters the ledger. */
export function validateDuelSchedule(schedule: DuelSchedule): void {
  if (!/^duel_[a-z0-9_-]{1,40}$/.test(schedule.duelId)) {
    throw new DuelError('duelId must look like duel_<id>.');
  }
  if (schedule.idolA === schedule.idolB) {
    throw new DuelError('A duel needs two different idols.');
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(schedule.mediaId)) {
    throw new DuelError('mediaId must be an Instagram media id.');
  }
  if (schedule.postUrl !== null && !/^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_./-]{1,200}$/.test(schedule.postUrl)) {
    throw new DuelError('postUrl must be an https://instagram.com link.');
  }
  const minutes = (schedule.endsAtMs - schedule.startsAtMs) / 60_000;
  if (!Number.isFinite(minutes) || minutes < DUEL_MIN_MINUTES || minutes > DUEL_MAX_MINUTES) {
    throw new DuelError(`A duel lasts ${DUEL_MIN_MINUTES} minutes to 7 days.`);
  }
}

/** Which side a comment supports, if it counts as a vote at that moment. */
export function sideOf(duel: Duel, mediaId: string, idolHandle: string, atMs: number): 'A' | 'B' | null {
  if (duel.status !== 'LIVE' || duel.mediaId !== mediaId || atMs < duel.startsAtMs || atMs >= duel.endsAtMs) {
    return null;
  }
  return idolHandle === duel.idolA ? 'A' : idolHandle === duel.idolB ? 'B' : null;
}

export function winnerOf(duel: Pick<Duel, 'idolA' | 'idolB' | 'votesA' | 'votesB'>): string | null {
  return duel.votesA === duel.votesB ? null : duel.votesA > duel.votesB ? duel.idolA : duel.idolB;
}
