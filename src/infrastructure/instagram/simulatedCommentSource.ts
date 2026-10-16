/**
 * Demo-only stand-in for Instagram: each tick produces a burst of comments
 * shaped exactly like Graph API ones, including the off-format kinds real fans
 * write. Each fandom rides its own "hype wave", so the global ranking keeps
 * overtaking itself the way a real launch would.
 */

import { InstagramCommentEvent } from '../../core/types.js';
import { CommentSource } from './commentSource.js';

const FIRST_NAMES = [
  'emma', 'liam', 'olivia', 'noah', 'ava', 'lucas', 'mia', 'kenji', 'yuna', 'aisha', 'omar', 'priya', 'arjun',
  'sofia', 'mateo', 'chloe', 'leo', 'zoe', 'hana', 'minjun', 'luca', 'nora', 'amir', 'ines', 'kai', 'lea',
];
const SUFFIXES = ['', '.fan', '_official', '.tv', '_army', '.daily', '_world', '.og', '_hq', '_xo'];

interface FandomWave {
  readonly handle: string;
  readonly base: number;
  readonly periodTicks: number;
}

/** Base popularity plus a wave period; phases come from the seed. */
const FANDOM_WAVES: readonly FandomWave[] = [
  { handle: 'taylorswift', base: 20, periodTicks: 34 },
  { handle: 'bts.bighitofficial', base: 19, periodTicks: 27 },
  { handle: 'badbunnypr', base: 14, periodTicks: 22 },
  { handle: 'realmadrid', base: 14, periodTicks: 30 },
  { handle: 'fcbarcelona', base: 12, periodTicks: 25 },
  { handle: 'blackpinkofficial', base: 11, periodTicks: 19 },
  { handle: 'cristiano', base: 11, periodTicks: 38 },
  { handle: 'mrbeast', base: 10, periodTicks: 21 },
  { handle: 'leomessi', base: 10, periodTicks: 33 },
  { handle: 'beyonce', base: 8, periodTicks: 29 },
  { handle: 'manchesterunited', base: 7, periodTicks: 24 },
  { handle: 'khaby00', base: 6, periodTicks: 18 },
  { handle: 'billieeilish', base: 3, periodTicks: 26 },
];

/** Mostly just the idol, the way real fans comment; some add their own @ or tag a friend. */
const MINT_TEMPLATES = [
  (_fan: string, fandom: string) => `@${fandom} let's take over this city!`,
  (_fan: string, fandom: string) => `@${fandom} 🔥🔥🔥`,
  (_fan: string, fandom: string) => `I want my home next to @${fandom}!`,
  (_fan: string, fandom: string) => `ride or die for @${fandom}`,
  (_fan: string, fandom: string) => `@${fandom}`,
  (fan: string, fandom: string) => `@${fan} @${fandom} straight to #1`,
  (fan: string, fandom: string) => `@${fan}_bestie come live next to @${fandom}!`,
];
const OFF_FORMAT_TEXTS = ['love this!!', 'how do I join?', '😍😍😍', 'first!', '@fanation.club this is so cool'];
/** Early fans who can become idols themselves, and how often a newcomer picks one. */
const RISING_STAR_POOL = 15;
const RISING_STAR_SHARE = 0.22;

/** mulberry32: tiny seeded PRNG so a demo run is reproducible. */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface SimulatedCommentSourceOptions {
  readonly seed?: number;
  readonly ticksPerPost?: number;
  /** After this many distinct fans only returning fans comment, so a long demo stays light. */
  readonly maxFans?: number;
  readonly now?: () => number;
}

export class SimulatedCommentSource implements CommentSource {
  readonly name = 'simulated' as const;
  private readonly rng: () => number;
  private readonly now: () => number;
  private readonly ticksPerPost: number;
  private readonly maxFans: number;
  private readonly phases: readonly number[];
  private readonly knownFans: { handle: string; fandom: string }[] = [];
  private tick = 0;
  private commentSeq = 0;

  constructor(options: SimulatedCommentSourceOptions = {}) {
    this.rng = createRng(options.seed ?? 20_261_016);
    this.now = options.now ?? Date.now;
    this.ticksPerPost = options.ticksPerPost ?? 8;
    this.maxFans = options.maxFans ?? 600;
    this.phases = FANDOM_WAVES.map(() => this.rng() * 2 * Math.PI);
  }

  async fetchComments(): Promise<InstagramCommentEvent[]> {
    this.tick += 1;
    const mediaId = `sim_post_${Math.ceil(this.tick / this.ticksPerPost)}`;
    const burst = 3 + Math.floor(this.rng() * 6);
    const baseMs = this.now();
    const events: InstagramCommentEvent[] = [];

    for (let i = 0; i < burst; i += 1) {
      const roll = this.rng();
      const receivedAtMs = baseMs + i * 137;
      const canAddFans = this.knownFans.length < this.maxFans;
      if ((roll < 0.68 && canAddFans) || this.knownFans.length === 0) {
        events.push(this.newFanComment(mediaId, receivedAtMs));
      } else if (roll < 0.88) {
        events.push(this.returningFanComment(mediaId, receivedAtMs));
      } else if (roll < 0.97) {
        events.push(this.event(mediaId, this.randomHandle(), this.pick(OFF_FORMAT_TEXTS), receivedAtMs));
      } else {
        // Someone naming only themselves: the filter must not mint a self-fandom.
        const author = this.randomHandle();
        events.push(this.event(mediaId, author, `@${author} is the real star`, receivedAtMs));
      }
    }
    return events;
  }

  private newFanComment(mediaId: string, receivedAtMs: number): InstagramCommentEvent {
    const handle = this.randomHandle();
    // The rule is the same for everyone: some newcomers idolise an early fan, who then grows.
    if (this.knownFans.length >= RISING_STAR_POOL && this.rng() < RISING_STAR_SHARE) {
      const star = this.knownFans[Math.floor(this.rng() ** 2 * RISING_STAR_POOL)].handle;
      if (star !== handle) {
        this.knownFans.push({ handle, fandom: star });
        return this.event(mediaId, handle, `@${star} you're my idol! 🌟`, receivedAtMs);
      }
    }
    const fandom = this.pickFandom();
    this.knownFans.push({ handle, fandom });
    return this.event(mediaId, handle, this.pick(MINT_TEMPLATES)(handle, fandom), receivedAtMs);
  }

  private returningFanComment(mediaId: string, receivedAtMs: number): InstagramCommentEvent {
    // Fans of a fandom on its hype peak come back more often.
    const fandom = this.pickFandom();
    const loyal = this.knownFans.filter((f) => f.fandom === fandom);
    const fan = loyal.length > 0 ? this.pick(loyal) : this.pick(this.knownFans);
    return this.event(mediaId, fan.handle, `@${fan.fandom} back to support!`, receivedAtMs);
  }

  private event(mediaId: string, author: string, text: string, receivedAtMs: number): InstagramCommentEvent {
    this.commentSeq += 1;
    return {
      commentId: `sim_${this.tick}_${this.commentSeq}`,
      mediaId,
      text,
      authorUsername: author,
      authorId: null,
      receivedAtMs,
    };
  }

  private randomHandle(): string {
    const digits = this.rng() < 0.5 ? String(Math.floor(this.rng() * 99)) : '';
    return `${this.pick(FIRST_NAMES)}${this.pick(SUFFIXES)}${digits}`;
  }

  private pickFandom(): string {
    const weights = FANDOM_WAVES.map(
      (wave, i) => wave.base * (1 + 0.85 * Math.sin((2 * Math.PI * this.tick) / wave.periodTicks + this.phases[i]))
    );
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = this.rng() * total;
    for (let i = 0; i < FANDOM_WAVES.length; i += 1) {
      roll -= weights[i];
      if (roll < 0) {
        return FANDOM_WAVES[i].handle;
      }
    }
    return FANDOM_WAVES[0].handle;
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rng() * items.length)];
  }
}
