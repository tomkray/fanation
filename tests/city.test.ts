/**
 * City rules: idol-only comments, one property per @handle, the same growth
 * rule for everyone (fans make any property grow), reputation that only the
 * profile earns, category cities, and the global leaderboard with momentum.
 */

import { describe, expect, it } from 'vitest';
import {
  applyCommentEvent,
  CityState,
  computeCityStandings,
  createCityState,
  DEFAULT_LEDGER_CONFIG,
  fansOf,
  propertyClassOf,
  topFans,
  topHolders,
} from '../src/core/cityLedger.js';
import { citySite } from '../src/core/cities.js';
import { BLOCK_PITCH_METERS, blockOf, cellToMeters, chunkKeyOfCell, LOT_SIZE_METERS, territoryOf } from '../src/core/cityLayout.js';
import { computeChampionshipStandings } from '../src/core/championship.js';
import { climbsBetween, movementAgainst, sampleStandings } from '../src/core/momentum.js';
import { fansForNextClass, propertyClassFor } from '../src/core/property.js';
import { settleLayout } from '../src/core/settle.js';
import { levelForXp, xpForLevel } from '../src/core/reputation.js';
import { InstagramCommentEvent, LandPlot } from '../src/core/types.js';
import { MomentumTracker } from '../src/infrastructure/momentumTracker.js';

let seq = 0;
function comment(author: string, text: string, mediaId = 'post_1', atMs = 1_760_000_000_000): InstagramCommentEvent {
  seq += 1;
  return { commentId: `c${seq}`, mediaId, text, authorUsername: author, authorId: null, receivedAtMs: atMs + seq * 61_000 };
}

function propertyOf(state: CityState, handle: string): LandPlot {
  const plot = state.plotIndexByMinter.get(handle);
  if (plot === undefined) {
    throw new Error(`@${handle} has no property`);
  }
  return state.lands[plot];
}

function lotDistance(a: LandPlot, b: LandPlot): number {
  return Math.hypot(a.coordinates.gridQ - b.coordinates.gridQ, a.coordinates.gridR - b.coordinates.gridR);
}

function standing(fandomHandle: string, fans: number, reputationXp: number) {
  return {
    fandomHandle,
    displayName: fandomHandle,
    category: 'ARTIST' as const,
    neonColorHex: '#BF5AF2',
    fans,
    reputationXp,
    district: { gridQ: 0, gridR: 0, x: 0, z: 0 },
    footprint: 'LOT' as const,
    propertyClass: propertyClassFor(fans, 'LOT'),
    city: 'COMMUNITY' as const,
  };
}

describe('comments name the idol; the author is the fan (A1, A2)', () => {
  it('moves the fan in next to the idol once, then only adds XP, once per post', () => {
    const state = createCityState();
    expect(applyCommentEvent(state, comment('alice_fan', 'love you @taylorswift'))).toMatchObject({
      status: 'MINTED_NEW_LAND',
      xpGained: 100,
      newFan: true,
      idolFans: 1,
      land: { minterHandle: 'alice_fan', idolHandle: 'taylorswift', fandomHandle: 'taylorswift' },
      idol: { minterHandle: 'taylorswift', footprint: 'BLOCK', city: 'MUSIC', idolHandle: null },
    });
    expect(applyCommentEvent(state, comment('alice_fan', '@taylorswift again'))).toMatchObject({ code: 'POST_ALREADY_COUNTED' });
    expect(applyCommentEvent(state, comment('alice_fan', '@taylorswift', 'post_2'))).toMatchObject({
      status: 'ENGAGEMENT_POINTS_ONLY',
      xpGained: 10,
      newFan: false,
    });
    expect(state.lands).toHaveLength(2);
    expect(state.reputationXpByHandle.get('alice_fan')).toBe(110);
    expect(state.reputationXpByFandom.get('taylorswift')).toBe(110);
    expect(fansOf(state, 'taylorswift')).toBe(1);
    // Era 0 pack: 1,000 $NEFA — 900 to the newcomer, 100 to the idol they named.
    expect(state.tokenBalancesMicro.get('alice_fan')).toBe(900_000_000n);
    expect(state.tokenBalancesMicro.get('taylorswift')).toBe(100_000_000n);
  });

  it("ignores the fan's own @, prefers a catalogued idol over tagged friends, accepts anyone as an idol", () => {
    const state = createCityState();
    expect(applyCommentEvent(state, comment('Bob.Fan', "I'm @Bob.Fan and I stan @fcbarcelona."))).toMatchObject({
      land: { minterHandle: 'bob.fan', idolHandle: 'fcbarcelona' },
      idol: { city: 'SPORTS' },
    });
    expect(applyCommentEvent(state, comment('carla', '@my_bestie come join @bts.bighitofficial'))).toMatchObject({
      land: { idolHandle: 'bts.bighitofficial' },
    });
    expect(applyCommentEvent(state, comment('dan', '@local_band_xyz forever'))).toMatchObject({
      land: { idolHandle: 'local_band_xyz' },
      idol: { footprint: 'LOT', city: 'COMMUNITY' },
    });
  });

  it('rejects comments without an idol, self-fandom, bidi tricks, the official account and duplicates', () => {
    const state = createCityState({ ...DEFAULT_LEDGER_CONFIG, officialAccountHandle: 'naoeumfa' });
    expect(applyCommentEvent(state, comment('erin', 'so cool!!'))).toMatchObject({ code: 'INVALID_COMMENT_FORMAT' });
    expect(applyCommentEvent(state, comment('frank', '@naoeumfa'))).toMatchObject({ code: 'INVALID_COMMENT_FORMAT' });
    expect(applyCommentEvent(state, comment('narcissus', '@narcissus'))).toMatchObject({ code: 'SELF_MINT_FORBIDDEN' });
    expect(applyCommentEvent(state, comment('eve', '@taylorswift\u202E'))).toMatchObject({ code: 'INVALID_COMMENT_FORMAT' });
    expect(applyCommentEvent(state, comment('naoeumfa', '@taylorswift'))).toMatchObject({ code: 'OWN_ACCOUNT_COMMENT' });
    const once = comment('dup', '@taylorswift');
    expect(applyCommentEvent(state, once).status).toBe('MINTED_NEW_LAND');
    expect(applyCommentEvent(state, once)).toMatchObject({ code: 'DUPLICATE_COMMENT_ID' });
  });

  it('rate-limits a handle to 5 events per minute', () => {
    const state = createCityState();
    const base = 1_760_000_000_000;
    const outcomes = Array.from({ length: 6 }, (_, i) =>
      applyCommentEvent(state, { commentId: `rl${i}`, mediaId: `p${i}`, text: '@taylorswift', authorUsername: 'speedy', authorId: null, receivedAtMs: base + i * 1000 })
    );
    expect(outcomes[5]).toMatchObject({ status: 'REJECTED', code: 'RATE_LIMIT_EXCEEDED' });
  });
});

describe('the same rule for everyone', () => {
  it('a fan who gains fans grows in place and gets a neighbourhood around their own home', () => {
    const state = createCityState();
    applyCommentEvent(state, comment('emma', '@taylorswift'));
    const emmaHome = propertyOf(state, 'emma');
    expect(propertyClassOf(state, emmaHome)).toBe('COTTAGE');

    for (let i = 0; i < 6; i += 1) {
      applyCommentEvent(state, comment(`emma_fan_${i}`, `@emma you're my idol`));
    }
    expect(propertyOf(state, 'emma')).toEqual(emmaHome);
    expect(fansOf(state, 'emma')).toBe(6);
    expect(propertyClassOf(state, propertyOf(state, 'emma'))).toBe('TOWNHOUSE');
    for (let i = 0; i < 6; i += 1) {
      const home = propertyOf(state, `emma_fan_${i}`);
      expect(home.fandomHandle).toBe('emma');
      expect(lotDistance(home, emmaHome)).toBeLessThan(4);
    }
    expect(computeCityStandings(state).map((s) => s.fandomHandle)).toEqual(['emma', 'taylorswift']);
  });

  it('someone named before they comment gets one property, which they later claim instead of a second one', () => {
    const state = createCityState();
    applyCommentEvent(state, comment('dan', '@carol_artist best ever'));
    const anchor = propertyOf(state, 'carol_artist');
    expect(anchor).toMatchObject({ footprint: 'LOT', city: 'COMMUNITY', idolHandle: null });
    // Named by dan's first comment: carol already holds her idol royalty.
    expect(state.tokenBalancesMicro.get('carol_artist')).toBe(100_000_000n);

    const claimed = applyCommentEvent(state, comment('carol_artist', '@taylorswift'));
    expect(claimed).toMatchObject({ status: 'ENGAGEMENT_POINTS_ONLY', xpGained: 100, newFan: true, land: { plotIndex: anchor.plotIndex } });
    expect(state.lands.filter((l) => l.minterHandle === 'carol_artist')).toHaveLength(1);
    expect(state.tokenBalancesMicro.get('carol_artist')).toBe(1_000_000_000n);
    expect(fansOf(state, 'carol_artist')).toBe(1);
  });

  it('a fan can support several idols: each counts them once, the home stays put', () => {
    const state = createCityState();
    applyCommentEvent(state, comment('lia', '@badbunnypr'));
    const home = propertyOf(state, 'lia');
    expect(applyCommentEvent(state, comment('lia', '@bts.bighitofficial', 'post_2'))).toMatchObject({ newFan: true, idolFans: 1 });
    expect(applyCommentEvent(state, comment('lia', '@bts.bighitofficial', 'post_3'))).toMatchObject({ newFan: false, idolFans: 1 });
    expect(propertyOf(state, 'lia')).toEqual(home);
    expect([fansOf(state, 'badbunnypr'), fansOf(state, 'bts.bighitofficial')]).toEqual([1, 1]);
  });

  it('property classes grow with fans; catalogued idols own a landmark block', () => {
    expect([0, 1, 5, 20, 100, 1_000, 10_000].map((f) => propertyClassFor(f, 'LOT'))).toEqual([
      'COTTAGE', 'HOUSE', 'TOWNHOUSE', 'VILLA', 'TOWER', 'SKYSCRAPER', 'MEGATOWER',
    ]);
    expect(propertyClassFor(3, 'BLOCK')).toBe('LANDMARK');
    expect(fansForNextClass(7, 'LOT')).toBe(20);
    expect(fansForNextClass(50_000, 'LOT')).toBeNull();
  });
});

describe('reputation (XP) and user rankings', () => {
  it('levels up on a growing curve', () => {
    expect([xpForLevel(1), xpForLevel(2), xpForLevel(3), xpForLevel(4)]).toEqual([0, 200, 500, 900]);
    expect([levelForXp(0), levelForXp(199), levelForXp(200), levelForXp(950)]).toEqual([1, 1, 2, 4]);
  });

  it('ranks users by XP and by $NEFA, and XP stays with the profile that earned it', () => {
    const state = createCityState();
    applyCommentEvent(state, comment('ana', '@badbunnypr'));
    applyCommentEvent(state, comment('ben', '@badbunnypr'));
    applyCommentEvent(state, comment('ben', '@badbunnypr', 'post_2'));
    expect(topFans(state, 5).map((f) => [f.handle, f.reputationXp, f.fandomHandle])).toEqual([
      ['ben', 110, 'badbunnypr'],
      ['ana', 100, 'badbunnypr'],
    ]);
    expect(topHolders(state, 5).map((f) => [f.handle, f.tokenBalanceMicro])).toEqual([
      ['ana', 900_000_000n],
      ['ben', 900_000_000n],
      ['badbunnypr', 200_000_000n],
    ]);
  });
});

describe('cities, districts and streaming chunks (A3)', () => {
  it('maps lots into 3×3 blocks with streets between them, and blocks into chunks', () => {
    expect([blockOf(-1), blockOf(0), blockOf(1), blockOf(2), blockOf(-2), blockOf(-4)]).toEqual([0, 0, 0, 1, -1, -1]);
    expect(cellToMeters(0, 0)).toEqual({ x: 0, z: 0 });
    expect(cellToMeters(1, -1)).toEqual({ x: LOT_SIZE_METERS, z: -LOT_SIZE_METERS });
    expect(cellToMeters(3, 0).x).toBe(BLOCK_PITCH_METERS);
    // Chunk 0 holds blocks 0..7, i.e. lots -1..22; lot 23 starts block 8 (chunk 1).
    expect([chunkKeyOfCell(0, 0), chunkKeyOfCell(22, 0), chunkKeyOfCell(23, -2)]).toEqual(['0:0', '0:0', '1:-1']);
  });

  it('splits the plane into four unbounded cities along two grand avenues, around the Capital', () => {
    expect([territoryOf(0, 500), territoryOf(-500, 1), territoryOf(5, 5)]).toEqual([null, null, 'CAPITAL']);
    expect([territoryOf(900, -900), territoryOf(900, 900), territoryOf(-900, 900), territoryOf(-900, -900)]).toEqual([
      'MUSIC', 'SPORTS', 'CREATORS', 'COMMUNITY',
    ]);
  });

  it('fills a solid disc around the idol first, then keeps growing when the idol is closed in', () => {
    const state = createCityState();
    applyCommentEvent(state, comment('emma', '@taylorswift'));
    for (let i = 0; i < 8; i += 1) {
      applyCommentEvent(state, comment(`n_${i}`, '@unknown_singer'));
    }
    const anchor = propertyOf(state, 'unknown_singer');
    const distances = Array.from({ length: 8 }, (_, i) => lotDistance(propertyOf(state, `n_${i}`), anchor));
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(distances[7]).toBeLessThanOrEqual(2 * Math.SQRT2);

    for (let i = 0; i < 3_000; i += 1) {
      applyCommentEvent(state, comment(`swiftie_${i}`, '@taylorswift'));
    }
    for (let i = 0; i < 40; i += 1) {
      expect(applyCommentEvent(state, comment(`emma_fan_${i}`, '@emma')).status).toBe('MINTED_NEW_LAND');
    }
    expect(fansOf(state, 'emma')).toBe(40);
    const outposts = state.layout.neighbourhoods.get('emma') ?? [];
    expect(outposts.length).toBeGreaterThan(0);
    const emmaHome = propertyOf(state, 'emma');
    const outpost = outposts[0];
    const nearOutpost = state.lands.filter(
      (l) => l.idolHandle === 'emma' && Math.hypot(l.coordinates.gridQ - outpost.gridQ, l.coordinates.gridR - outpost.gridR) < 6
    );
    expect(nearOutpost.length).toBeGreaterThan(20);
    expect(Math.hypot(outpost.gridQ - emmaHome.coordinates.gridQ, outpost.gridR - emmaHome.coordinates.gridR)).toBeGreaterThan(6);
    const cells = new Set(state.lands.map((l) => `${l.coordinates.gridQ}:${l.coordinates.gridR}`));
    expect(cells.size).toBe(state.lands.length);
    for (const land of state.lands) {
      const spread = land.footprint === 'BLOCK' ? 1 : 0;
      for (let dq = -spread; dq <= spread; dq += 1) {
        for (let dr = -spread; dr <= spread; dr += 1) {
          expect(territoryOf(land.coordinates.gridQ + dq, land.coordinates.gridR + dr)).toBe(land.city);
        }
      }
    }
  });

  it('builds every fan next to their own idol, in their idol\'s city, never overlapping', () => {
    const state = createCityState();
    const idols = ['taylorswift', 'bts.bighitofficial', 'realmadrid', 'mrbeast'];
    for (let i = 0; i < 400; i += 1) {
      applyCommentEvent(state, comment(`fan_${i}`, `@${idols[i % idols.length]}`));
    }
    const cells = new Set(state.lands.map((l) => `${l.coordinates.gridQ}:${l.coordinates.gridR}`));
    expect(cells.size).toBe(state.lands.length);
    expect(propertyOf(state, 'realmadrid').city).toBe('SPORTS');
    expect(propertyOf(state, 'mrbeast').city).toBe('CREATORS');

    const nearOwn = state.lands.filter((land) => {
      if (!land.idolHandle) {
        return false;
      }
      const own = lotDistance(land, propertyOf(state, land.idolHandle));
      return idols.every((other) => own <= lotDistance(land, propertyOf(state, other)));
    });
    expect(nearOwn.length).toBe(400);
    const music = citySite('MUSIC');
    expect(Math.hypot(propertyOf(state, 'taylorswift').coordinates.gridQ - music.centerQ, propertyOf(state, 'taylorswift').coordinates.gridR - music.centerR)).toBeLessThan(15);
    expect(computeCityStandings(state).every((s) => s.fans === 100 && s.reputationXp === 10_000)).toBe(true);
  });
});

describe('the city reorganizes itself each layout epoch (A3)', () => {
  /** Interleaved arrivals: a fan-turned-idol gains fans while the big districts keep growing around them. */
  function growInterleaved(state: CityState, total: number): void {
    for (let i = 0; i < total; i += 1) {
      // Every fifth comment names one of the first eight fans, who live inside the big districts.
      const idol = i % 5 === 4 ? `fan_${Math.floor(i / 5) % 8}` : ['taylorswift', 'bts.bighitofficial', 'realmadrid', 'mrbeast'][i % 4];
      applyCommentEvent(state, comment(`fan_${i}`, `@${idol}`));
    }
  }

  function spreadOfFans(state: CityState, idol: string): number {
    const home = propertyOf(state, idol);
    const fans = state.lands.filter((l) => l.idolHandle === idol);
    return Math.max(...fans.map((l) => lotDistance(l, home)));
  }

  it('rebuilds every following in one piece, identically every time, without moving ownership', () => {
    const state = createCityState();
    growInterleaved(state, 2_500);
    const owners = state.lands.map((l) => [l.plotIndex, l.minterHandle, l.ownerHandle, l.idolHandle]);
    const before = spreadOfFans(state, 'fan_0');

    settleLayout(state);
    const first = state.lands.map((l) => l.coordinates);
    settleLayout(state);
    expect(state.lands.map((l) => l.coordinates)).toEqual(first);
    expect(state.lands.map((l) => [l.plotIndex, l.minterHandle, l.ownerHandle, l.idolHandle])).toEqual(owners);

    // Compact: no farther than a half-disc holding all of them (the other half is their own idol's district).
    const fans = fansOf(state, 'fan_0');
    expect(spreadOfFans(state, 'fan_0')).toBeLessThan(before);
    expect(spreadOfFans(state, 'fan_0')).toBeLessThanOrEqual(Math.sqrt((2 * fans) / Math.PI) + 2);
    const cells = new Set(state.lands.map((l) => `${l.coordinates.gridQ}:${l.coordinates.gridR}`));
    expect(cells.size).toBe(state.lands.length);
    expect(state.lands.every((l) => territoryOf(l.coordinates.gridQ, l.coordinates.gridR) === l.city)).toBe(true);

    // The live map keeps growing from the rebuilt one without collisions.
    growInterleaved(state, 300);
    expect(new Set(state.lands.map((l) => `${l.coordinates.gridQ}:${l.coordinates.gridR}`)).size).toBe(state.lands.length);
  });

  it('rebuilds on the first comment of a new epoch, only when something was built', () => {
    const state = createCityState({ ...DEFAULT_LEDGER_CONFIG, layoutEpochMs: 60_000 });
    const base = 1_800_000_000_000;
    const at = (n: number, author: string, text: string): void => {
      applyCommentEvent(state, { commentId: `ep${n}`, mediaId: `m${n}`, text, authorUsername: author, authorId: null, receivedAtMs: base + n * 20_000 });
    };
    at(0, 'a1', '@taylorswift');
    at(1, 'a2', '@taylorswift');
    expect(state.layoutEpoch.rebuilds).toBe(0);
    at(3, 'a3', '@taylorswift');
    expect(state.layoutEpoch.rebuilds).toBe(1);
    at(6, 'a3', '@taylorswift');
    at(9, 'a3', 'no idol here');
    expect(state.layoutEpoch.rebuilds).toBe(2);
    at(12, 'a3', 'still nothing');
    expect(state.layoutEpoch.rebuilds).toBe(2);
  });
});

describe('global leaderboard', () => {
  it('ranks every idol in one table by the XP fans earned, with top-N perks', () => {
    const standings = computeChampionshipStandings([
      { ...standing('taylorswift', 50, 5_500), category: 'ARTIST' },
      { ...standing('realmadrid', 120, 13_200), category: 'CLUB' },
      { ...standing('mrbeast', 70, 7_000), category: 'INFLUENCER' },
      { ...standing('emma', 10, 1_000), category: 'UNLISTED' },
    ]);
    expect(standings.map((s) => s.fandomHandle)).toEqual(['realmadrid', 'mrbeast', 'taylorswift', 'emma']);
    expect(standings[0].perks).toEqual({ specialDistrictLighting: true, monument3D: true, holographicBillboard: true });
    expect(standings[3].perks).toEqual({ specialDistrictLighting: true, monument3D: false, holographicBillboard: false });
  });

  it('measures positions gained, XP change in % and newcomers against a baseline', () => {
    const before = computeChampionshipStandings([standing('bts', 10, 1_000), standing('badbunny', 8, 800)]);
    const after = computeChampionshipStandings([standing('bts', 10, 1_000), standing('badbunny', 12, 1_200), standing('beyonce', 1, 100)]);
    const baseline = sampleStandings(1_000, before);
    const find = (handle: string) => {
      const s = after.find((x) => x.fandomHandle === handle);
      if (!s) {
        throw new Error(`missing ${handle}`);
      }
      return s;
    };
    expect(movementAgainst(baseline, find('badbunny'))).toEqual({ rankDelta: 1, scoreDeltaPct: 50, isNew: false });
    expect(movementAgainst(baseline, find('bts'))).toEqual({ rankDelta: -1, scoreDeltaPct: 0, isNew: false });
    expect(movementAgainst(baseline, find('beyonce'))).toEqual({ rankDelta: 0, scoreDeltaPct: null, isNew: true });
    expect(climbsBetween(baseline, sampleStandings(2_000, after))).toEqual([
      { atMs: 2_000, fandomHandle: 'badbunny', fromRank: 2, toRank: 1 },
      { atMs: 2_000, fandomHandle: 'beyonce', fromRank: 3, toRank: 3 },
    ]);
  });

  it('keeps a baseline exactly one window old as time moves on', () => {
    const tracker = new MomentumTracker(60_000);
    tracker.record(0, computeChampionshipStandings([standing('bts', 1, 100)]));
    tracker.record(30_000, computeChampionshipStandings([standing('bts', 2, 200)]));
    expect(tracker.baseline(40_000)?.atMs).toBe(0);
    tracker.record(90_000, computeChampionshipStandings([standing('bts', 3, 300)]));
    expect(tracker.baseline(95_000)?.atMs).toBe(30_000);
  });
});
