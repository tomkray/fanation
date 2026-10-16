/**
 * Keeps a thinned history of the global ranking so every snapshot can say how
 * each fandom moved over the momentum window, plus the latest climbs. Driven
 * by comment times, so a journal replay rebuilds the same history.
 */

import { climbsBetween, RankChange, RankSample, sampleStandings } from '../core/momentum.js';
import { FandomClubStats } from '../core/types.js';

const SAMPLES_PER_WINDOW = 60;
const MAX_RECENT_CHANGES = 12;

export class MomentumTracker {
  private readonly samples: RankSample[] = [];
  private readonly changes: RankChange[] = [];
  private last: RankSample | null = null;
  private readonly sampleEveryMs: number;

  constructor(readonly windowMs: number) {
    this.sampleEveryMs = Math.max(1_000, Math.floor(windowMs / SAMPLES_PER_WINDOW));
  }

  record(atMs: number, standings: readonly FandomClubStats[]): void {
    // Webhook and poll batches can arrive slightly out of order; history only moves forward.
    const at = this.last ? Math.max(atMs, this.last.atMs) : atMs;
    const sample = sampleStandings(at, standings);
    if (this.last) {
      this.changes.unshift(...climbsBetween(this.last, sample));
      if (this.changes.length > MAX_RECENT_CHANGES) {
        this.changes.length = MAX_RECENT_CHANGES;
      }
    }
    this.last = sample;

    const newest = this.samples[this.samples.length - 1];
    if (!newest || at - newest.atMs >= this.sampleEveryMs) {
      this.samples.push(sample);
    }
    this.prune(at);
  }

  /** The newest sample at least one window old; early on, the oldest one we have. */
  baseline(nowMs: number): RankSample | null {
    const cutoff = nowMs - this.windowMs;
    let candidate: RankSample | null = null;
    for (const sample of this.samples) {
      if (sample.atMs > cutoff) {
        break;
      }
      candidate = sample;
    }
    return candidate ?? this.samples[0] ?? null;
  }

  get recentChanges(): readonly RankChange[] {
    return this.changes;
  }

  /** Drops samples older than the one that is still the baseline candidate. */
  private prune(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    let keepFrom = 0;
    for (let i = 0; i < this.samples.length && this.samples[i].atMs <= cutoff; i += 1) {
      keepFrom = i;
    }
    if (keepFrom > 0) {
      this.samples.splice(0, keepFrom);
    }
  }
}
