/**
 * Trying to cheat the reducer. Thousands of random and hostile moves (repeated
 * comments, overdrafts, double payments, self-trades, the official account,
 * bids on sold homes) against invariants that must hold after every step, then
 * a cold replay that must rebuild the same book. Plus the one door-crossing
 * case: a comment pasted through Muse and read again through the API.
 */

import { describe, expect, it } from 'vitest';
import { CityState } from '../src/core/cityLedger.js';
import { MAX_SUPPLY_MICRO } from '../src/core/tokenomics.js';
import { InstagramCommentEvent, PaymentMethod } from '../src/core/types.js';
import { CityService } from '../src/infrastructure/cityService.js';
import { parseMuseBatch } from '../src/infrastructure/instagram/museBridge.js';
import { legacyMuseMediaIds } from '../src/infrastructure/instagram/postKey.js';
import { MemoryEventJournal } from '../src/infrastructure/persistence/eventJournal.js';

const OFFICIAL = 'naoeumfa';
const CONFIG = { officialAccountHandle: OFFICIAL, layoutEpochMs: null, seasonLengthMs: 15 * 60_000 };
const START_MS = 1_800_000_000_000;

function city(journal = new MemoryEventJournal()): { city: CityService; journal: MemoryEventJournal } {
  const c = new CityService(CONFIG, journal, (err) => {
    throw err;
  });
  c.boot();
  return { city: c, journal };
}

/** mulberry32: the same seed always plays the same game. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function totalHeld(state: Readonly<CityState>): bigint {
  let sum = 0n;
  for (const micro of state.tokenBalancesMicro.values()) {
    sum += micro;
  }
  for (const l of state.listings.values()) {
    if (l.assetType === 'NEFA_PACK' && l.tokenAmountMicro !== null && (l.status === 'OPEN' || l.status === 'LOCKED_ESCROW')) {
      sum += l.tokenAmountMicro;
    }
  }
  return sum;
}

function assertInvariants(state: Readonly<CityState>): void {
  // No $NEFA is created or destroyed outside the mint and season rules.
  const issued = state.tokenomics.fanMintedMicro + state.tokenomics.seasonPaidMicro;
  expect(totalHeld(state)).toBe(issued);
  expect(issued <= MAX_SUPPLY_MICRO).toBe(true);
  for (const micro of state.tokenBalancesMicro.values()) {
    expect(micro >= 0n).toBe(true);
  }
  // One mint per @, forever; every deed has exactly one holder.
  const minters = new Set<string>();
  let deeds = 0;
  for (const land of state.lands) {
    expect(minters.has(land.minterHandle)).toBe(false);
    minters.add(land.minterHandle);
    expect(state.plotsByOwner.get(land.ownerHandle)?.has(land.plotIndex)).toBe(true);
  }
  for (const plots of state.plotsByOwner.values()) {
    deeds += plots.size;
  }
  expect(deeds).toBe(state.lands.length);
  // A payment reference settles one listing, once.
  const settled = [...state.listings.values()].filter((l) => l.status === 'SETTLED');
  expect(new Set(settled.map((l) => l.externalTxRef)).size).toBe(settled.length);
  expect(state.settledTxRefs.size).toBe(settled.length);
  // The official account holds nothing.
  expect(state.tokenBalancesMicro.get(OFFICIAL) ?? 0n).toBe(0n);
  expect(state.reputationXpByHandle.get(OFFICIAL) ?? 0).toBe(0);
  expect(state.plotsByOwner.get(OFFICIAL)?.size ?? 0).toBe(0);
  expect(state.fansByIdol.get(OFFICIAL) ?? 0).toBe(0);
}

/** Everything a cheat would want to change, in a comparable form. */
function snapshot(state: Readonly<CityState>): unknown {
  const sortMap = <V>(m: ReadonlyMap<string, V>) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return {
    balances: sortMap(state.tokenBalancesMicro).map(([k, v]) => [k, v.toString()]),
    xp: sortMap(state.reputationXpByHandle),
    lands: state.lands.map((l) => [l.plotIndex, l.minterHandle, l.ownerHandle]),
    listings: sortMap(state.listings).map(([k, l]) => [k, l.status, l.buyerHandle, l.externalTxRef]),
    offers: sortMap(state.offers).map(([k, o]) => [k, o.status, o.listingId]),
    minted: state.tokenomics.fanMintedMicro.toString(),
    seasonPaid: state.tokenomics.seasonPaidMicro.toString(),
  };
}

describe('the reducer against cheating', () => {
  it('holds every invariant through 3,000 hostile moves and replays to the same book', () => {
    const random = rng(20_261_016);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
    const fans = Array.from({ length: 24 }, (_, i) => `fan_${i}`);
    const idols = ['taylorswift', 'bts.bighitofficial', 'realmadrid'];
    const people = [...fans, ...idols, OFFICIAL];
    const methods: PaymentMethod[] = ['PIX', 'USDT', 'BTC'];
    const { city: live, journal } = city();
    let now = START_MS;
    let refused = 0;

    const attempt = (move: () => unknown): void => {
      try {
        move();
      } catch {
        refused += 1;
      }
    };

    for (let step = 0; step < 3_000; step += 1) {
      now += Math.floor(random() * 90_000);
      const state = live.stateView;
      const roll = random();
      const someone = pick(people);
      if (roll < 0.4) {
        const text = pick([`@${pick(idols)}`, `@${pick(fans)}`, `@${pick(idols)} @${pick(fans)}`, 'oi', `@${OFFICIAL}`, `@${someone}`]);
        // A small pool of ids so the same comment keeps coming back.
        const event: InstagramCommentEvent = {
          commentId: `c${Math.floor(random() * 900)}`,
          mediaId: pick(['ig_postA', 'ig_postB', 'ig_postC']),
          text,
          authorUsername: someone,
          authorId: null,
          receivedAtMs: now,
        };
        live.ingestComments([event], pick(['instagram_webhook', 'instagram_poll', 'muse_bridge'] as const));
      } else if (roll < 0.55) {
        const balance = state.tokenBalancesMicro.get(someone) ?? 0n;
        const amount = BigInt(Math.floor(random() * 2_000_000_000)) + (random() < 0.3 ? balance : 0n);
        attempt(() => live.transferTokens(someone, pick(people), amount));
      } else if (roll < 0.63) {
        const amount = BigInt(Math.floor(random() * 1_500_000_000));
        attempt(() =>
          live.createListing({
            listingId: `lst_${step}`,
            sellerHandle: someone,
            assetType: 'NEFA_PACK',
            plotIndex: null,
            tokenAmountMicro: amount,
            priceBrlCents: 1_000n,
            priceUsdtMicro: 2_000_000n,
            priceBtcSats: 3_000n,
            nowIso: '',
          })
        );
      } else if (roll < 0.7) {
        attempt(() => live.listProperty(someone, Math.floor(random() * Math.max(1, state.lands.length + 2)), 5_000n));
      } else if (roll < 0.78) {
        const listing = pick([...state.listings.values()]);
        if (listing) {
          attempt(() => live.lockCheckout({ listingId: listing.listingId, buyerHandle: someone, paymentMethod: pick(methods), checkoutRef: `ck_${step}`, nowMs: now }));
        }
      } else if (roll < 0.86) {
        const locked = [...state.listings.values()].filter((l) => l.status === 'LOCKED_ESCROW' && l.lock);
        const listing = pick(locked);
        if (listing?.lock) {
          const honest = random() < 0.7;
          attempt(() =>
            live.settlePayment({
              listingId: listing.listingId,
              buyerHandle: honest ? listing.lock!.buyerHandle : someone,
              paymentMethod: honest ? listing.lock!.paymentMethod : pick(methods),
              paidAmountInteger: BigInt(Math.floor(random() * 4_000_000)),
              // Replayed and padded references on purpose.
              externalTxRef: `${pick(['TXREF0001', 'TXREF0002', `TXREF${step}AA`])}${random() < 0.3 ? ' ' : ''}`,
              settledAtIso: '',
            })
          );
        }
      } else if (roll < 0.9) {
        const listing = pick([...state.listings.values()].filter((l) => l.status === 'OPEN'));
        if (listing) {
          attempt(() => live.cancelListing(listing.listingId, random() < 0.5 ? listing.sellerHandle : someone));
        }
      } else if (roll < 0.95) {
        attempt(() => live.makeOffer(someone, Math.floor(random() * Math.max(1, state.lands.length + 2)), BigInt(50 + Math.floor(random() * 30_000))));
      } else {
        const offer = pick([...state.offers.values()]);
        if (offer) {
          const actor = random() < 0.5 ? offer.toHandle : someone;
          attempt(() => pick([() => live.acceptOffer(offer.offerId, actor), () => live.declineOffer(offer.offerId, actor), () => live.withdrawOffer(offer.offerId, random() < 0.5 ? offer.fromHandle : someone)])());
        }
      }
      assertInvariants(live.stateView);
    }

    // The attack actually happened: plenty of moves were refused, plenty went through.
    expect(refused).toBeGreaterThan(300);
    expect(live.stateView.lands.length).toBeGreaterThan(10);
    expect([...live.stateView.listings.values()].some((l) => l.status === 'SETTLED')).toBe(true);

    const { city: replayed } = city(journal);
    expect(snapshot(replayed.stateView)).toEqual(snapshot(live.stateView));
    expect(replayed.ledgerHead()).toEqual(live.ledgerHead());
  });

  it('settles one payment reference once, even padded with spaces', () => {
    const { city: live } = city();
    live.ingestComments(
      [
        { commentId: 'p1', mediaId: 'ig_postA', text: '@taylorswift', authorUsername: 'seller', authorId: null, receivedAtMs: START_MS },
        { commentId: 'p2', mediaId: 'ig_postA', text: '@taylorswift', authorUsername: 'buyer', authorId: null, receivedAtMs: START_MS + 61_000 },
      ],
      'instagram_webhook'
    );
    const pack = (listingId: string) =>
      live.createListing({ listingId, sellerHandle: 'seller', assetType: 'NEFA_PACK', plotIndex: null, tokenAmountMicro: 1_000_000n, priceBrlCents: 1_000n, priceUsdtMicro: 2_000_000n, priceBtcSats: 3_000n, nowIso: '' });
    const pay = (listingId: string, ref: string) => {
      live.lockCheckout({ listingId, buyerHandle: 'buyer', paymentMethod: 'PIX', checkoutRef: `ck_${listingId}`, nowMs: START_MS });
      return live.settlePayment({ listingId, buyerHandle: 'buyer', paymentMethod: 'PIX', paidAmountInteger: 1_000n, externalTxRef: ref, settledAtIso: '' });
    };
    pack('lst_one');
    pack('lst_two');
    expect(pay('lst_one', 'PIX-E2E-0001')).not.toBeNull();
    expect(pay('lst_two', ' PIX-E2E-0001 ')).toBeNull();
    expect(live.stateView.listings.get('lst_two')?.status).toBe('LOCKED_ESCROW');
  });

  it('applies the same Muse paste only once, however often it is sent', () => {
    const { city: live } = city();
    const batch = {
      mediaUrl: 'https://www.instagram.com/p/DekwZzUpxZP/',
      comments: [
        { authorUsername: 'ana', text: '@taylorswift', timestamp: new Date(START_MS).toISOString() },
        { authorUsername: 'ANA', text: '  @taylorswift  ', timestamp: new Date(START_MS).toISOString() },
      ],
    };
    const first = parseMuseBatch(batch);
    if (!first.ok) {
      throw new Error(first.error);
    }
    expect(live.ingestComments(first.events, 'muse_bridge')).toHaveLength(1);
    const tokens = live.stateView.tokenBalancesMicro.get('ana');
    const again = parseMuseBatch(batch);
    if (!again.ok) {
      throw new Error(again.error);
    }
    expect(live.ingestComments(again.events, 'muse_bridge')).toHaveLength(0);
    expect(live.stateView.tokenBalancesMicro.get('ana')).toBe(tokens);
    expect(live.stateView.reputationXpByHandle.get('ana')).toBe(100);
  });

  it('never scores twice when a pasted comment is read again through the API', () => {
    const { city: live } = city();
    const pasted = parseMuseBatch({
      mediaUrl: 'https://www.instagram.com/reel/DekwZzUpxZP/?igsh=abc',
      comments: [{ authorUsername: 'ana', text: '@taylorswift', timestamp: new Date(START_MS).toISOString() }],
    });
    if (!pasted.ok) {
      throw new Error(pasted.error);
    }
    expect(pasted.mediaId).toBe('ig_DekwZzUpxZP');
    live.ingestComments(pasted.events, 'muse_bridge');
    const before = { xp: live.stateView.reputationXpByHandle.get('ana'), nefa: live.stateView.tokenBalancesMicro.get('ana') };

    // Graph API: Meta's own comment id, the post keyed by its code.
    const [outcome] = live.ingestComments(
      [{ commentId: '17901234567890123', mediaId: 'ig_DekwZzUpxZP', text: '@taylorswift', authorUsername: 'ana', authorId: '1784', receivedAtMs: START_MS + 1_000 }],
      'instagram_poll'
    );
    expect(outcome).toMatchObject({ status: 'REJECTED', code: 'POST_ALREADY_COUNTED' });
    expect({ xp: live.stateView.reputationXpByHandle.get('ana'), nefa: live.stateView.tokenBalancesMicro.get('ana') }).toEqual(before);
  });

  it('keeps posts recorded under the old Muse id as the same post', () => {
    const { city: live } = city();
    const [legacy] = legacyMuseMediaIds('DekwZzUpxZP');
    live.ingestComments([{ commentId: 'old_1', mediaId: legacy, text: '@taylorswift', authorUsername: 'ana', authorId: null, receivedAtMs: START_MS }], 'muse_bridge');
    const [outcome] = live.ingestComments(
      [{ commentId: '17901234567890124', mediaId: 'ig_DekwZzUpxZP', text: '@taylorswift', authorUsername: 'ana', authorId: null, receivedAtMs: START_MS + 1_000 }],
      'instagram_poll'
    );
    expect(outcome).toMatchObject({ status: 'REJECTED', code: 'POST_ALREADY_COUNTED' });
    expect(live.stateView.reputationXpByHandle.get('ana')).toBe(100);
  });
});
