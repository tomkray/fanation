/**
 * $NEFA (A11): the cap is never exceeded, packs halve by era, idols earn their
 * royalty, seasons pay by reputation within their pool, and friend tags pay
 * +1 XP once per friend with a daily cap.
 */

import { describe, expect, it } from 'vitest';
import { applyCommentEvent, CityState, createCityState, DEFAULT_LEDGER_CONFIG, FRIEND_TAGS_PER_DAY } from '../src/core/cityLedger.js';
import {
  ALLOCATION_BPS,
  bucketCapMicro,
  distributeByWeight,
  FIRST_ERA_MEMBERS,
  MAX_SUPPLY_MICRO,
  MICRO_PER_NEFA,
  mintEraFor,
  seasonPrizeMicro,
  splitPack,
} from '../src/core/tokenomics.js';

let seq = 0;
function say(state: CityState, author: string, text: string, atMs: number, mediaId = `m${seq}`): ReturnType<typeof applyCommentEvent> {
  seq += 1;
  return applyCommentEvent(state, { commentId: `t${seq}`, mediaId, text, authorUsername: author, authorId: null, receivedAtMs: atMs });
}

describe('$NEFA supply', () => {
  it('allocates exactly 100M across the buckets', () => {
    expect(Object.values(ALLOCATION_BPS).reduce((a, b) => a + b, 0n)).toBe(10_000n);
    expect(MAX_SUPPLY_MICRO).toBe(100_000_000n * MICRO_PER_NEFA);
    expect(bucketCapMicro('FAN_MINT')).toBe(60_000_000n * MICRO_PER_NEFA);
  });

  it('halves the pack every era while doubling the era, and stops at the cap', () => {
    expect(mintEraFor(0)).toMatchObject({ era: 0, packMicro: 1_000n * MICRO_PER_NEFA, nextEraAtMember: FIRST_ERA_MEMBERS });
    expect(mintEraFor(FIRST_ERA_MEMBERS)).toMatchObject({ era: 1, packMicro: 500n * MICRO_PER_NEFA, nextEraAtMember: FIRST_ERA_MEMBERS * 3 });
    expect(mintEraFor(FIRST_ERA_MEMBERS * 3).packMicro).toBe(250n * MICRO_PER_NEFA);
    // Every era emits the same 3M $NEFA, so all 20 eras add up to the 60M Mint de Fã bucket.
    let total = 0n;
    for (let era = 0; era < 20; era += 1) {
      const e = mintEraFor(FIRST_ERA_MEMBERS * (2 ** era - 1));
      total += e.packMicro * BigInt(FIRST_ERA_MEMBERS * 2 ** era);
    }
    // Integer halving truncates from era 10 on: ~1,490 $NEFA of dust is never minted. The cap is a ceiling, never exceeded.
    expect(total).toBeLessThanOrEqual(bucketCapMicro('FAN_MINT'));
    expect(total).toBeGreaterThan(bucketCapMicro('FAN_MINT') - 1_500n * MICRO_PER_NEFA);
    expect(mintEraFor(Number.MAX_SAFE_INTEGER).packMicro).toBe(0n);
    expect(splitPack(0, bucketCapMicro('FAN_MINT'))).toEqual({ memberMicro: 0n, idolMicro: 0n });
    expect(splitPack(0, bucketCapMicro('FAN_MINT') - 5n)).toEqual({ memberMicro: 5n, idolMicro: 0n });
  });

  it('pays a season by weight, caps any one handle, and never pays more than the prize', () => {
    const prize = seasonPrizeMicro(0n);
    expect(prize).toBe(bucketCapMicro('SEASONS') / 100n);
    const { payouts, paidMicro } = distributeByWeight(prize, new Map([['whale', 1_000_000], ['a', 10], ['b', 10]]));
    expect(payouts.get('whale')).toBe((prize * 200n) / 10_000n);
    expect(paidMicro).toBeLessThanOrEqual(prize);
    expect(seasonPrizeMicro(bucketCapMicro('SEASONS'))).toBe(0n);
  });
});

describe('$NEFA in the ledger', () => {
  it('mints one pack per new member, with the idol royalty, and tracks it', () => {
    const state = createCityState();
    say(state, 'ana', '@taylorswift', 1);
    say(state, 'ana', '@taylorswift', 2);
    expect(state.tokenomics).toMatchObject({ members: 1, fanMintedMicro: 1_000n * MICRO_PER_NEFA, idolRoyaltiesMicro: 100n * MICRO_PER_NEFA });
    expect(state.tokenBalancesMicro.get('ana')).toBe(900n * MICRO_PER_NEFA);
  });

  it('pays each finished season by the XP earned in it, to fans and idols', () => {
    const state = createCityState({ ...DEFAULT_LEDGER_CONFIG, seasonLengthMs: 1_000_000 });
    say(state, 'ana', '@badbunnypr', 10);
    say(state, 'ben', '@badbunnypr', 20);
    say(state, 'ben', '@badbunnypr', 30);
    const before = state.tokenBalancesMicro.get('ben') ?? 0n;
    say(state, 'carl', '@mrbeast', 1_000_010);
    const season = state.tokenomics.lastSeason;
    expect(season?.season).toBe(1);
    expect(state.tokenomics.seasonPaidMicro).toBe(season?.paidMicro);
    expect((state.tokenBalancesMicro.get('ben') ?? 0n) - before).toBeGreaterThan(0n);
    expect(season?.top.some((t) => t.handle === 'badbunnypr')).toBe(true);
    // Season XP restarts; lifetime XP does not.
    expect(state.tokenomics.seasonXp.get('ben')).toBeUndefined();
    expect(state.reputationXpByHandle.get('ben')).toBe(110);
  });
});

describe('friend tags', () => {
  it('pays +1 XP per new friend for registered members, once per friend, never for repeats', () => {
    const state = createCityState();
    say(state, 'ana', '@taylorswift @bob', 100);
    expect(state.reputationXpByHandle.get('ana')).toBe(100);
    const tagged = say(state, 'ana', '@taylorswift @bob @carla @carla', 200);
    expect(tagged).toMatchObject({ xpGained: 10 + 2 });
    say(state, 'ana', '@taylorswift @bob @carla', 300);
    expect(state.reputationXpByHandle.get('ana')).toBe(100 + 12 + 10);
  });

  it(`stops paying after ${FRIEND_TAGS_PER_DAY} new friends a day`, () => {
    const state = createCityState();
    say(state, 'spam', '@taylorswift', 0);
    for (let i = 0; i < 10; i += 1) {
      const friends = Array.from({ length: 5 }, (_, k) => `@pal_${i}_${k}`).join(' ');
      say(state, 'spam', `@taylorswift ${friends}`, (i + 1) * 61_000);
    }
    expect(state.friendTagsToday.get('spam')?.count).toBe(FRIEND_TAGS_PER_DAY);
  });
});
