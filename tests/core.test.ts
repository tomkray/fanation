/**
 * Fanation Club boundary suite: marketplace (A5), PIX, the Meta webhook, the
 * Graph API collector and journal replay (A6). City rules live in city.test.ts.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyCheckoutLocked,
  applyCommentEvent,
  applyListingCreated,
  applyLotAdSet,
  applyPaymentSettled,
  CityState,
  computeCityStandings,
  createCityState,
  DEFAULT_LEDGER_CONFIG,
  homesOwnedBy,
  plotsOwnedBy,
} from '../src/core/cityLedger.js';
import { LotAdError } from '../src/core/lotAd.js';
import { MarketError } from '../src/core/marketplace.js';
import { buildPixBrCode, crc16CcittFalse } from '../src/core/pix.js';
import { InstagramCommentEvent } from '../src/core/types.js';
import { CityService } from '../src/infrastructure/cityService.js';
import { MemoryEventJournal } from '../src/infrastructure/persistence/eventJournal.js';
import {
  parseMetaCommentWebhook,
  resolveSubscriptionChallenge,
  verifyMetaSignature,
} from '../src/infrastructure/instagram/metaWebhook.js';
import { GraphCommentSource } from '../src/infrastructure/instagram/graphCommentSource.js';

let seq = 0;
function comment(author: string, text: string, mediaId = 'post_1', atMs = 1_760_000_000_000): InstagramCommentEvent {
  seq += 1;
  return { commentId: `c${seq}`, mediaId, text, authorUsername: author, authorId: null, receivedAtMs: atMs + seq * 61_000 };
}

describe('marketplace (A5)', () => {
  function cityWithSeller(): CityState {
    const state = createCityState();
    applyCommentEvent(state, comment('seller_pro', '@manchesterunited'));
    applyListingCreated(state, {
      listingId: 'lst_001',
      sellerHandle: 'seller_pro',
      assetType: 'LAND_PLOT',
      // Plot 0 is @manchesterunited's landmark, created when the fan named it; the fan's home is plot 1.
      plotIndex: 1,
      tokenAmountMicro: null,
      priceBrlCents: 25_000n,
      priceUsdtMicro: 46_296_296n,
      priceBtcSats: 41_666n,
      nowIso: '2026-10-16T12:00:00.000Z',
    });
    return state;
  }

  it('locks for one buyer, settles in integers and moves the home — never the mint or the XP', () => {
    const state = cityWithSeller();
    applyCheckoutLocked(state, { listingId: 'lst_001', buyerHandle: 'buyer_whale', paymentMethod: 'PIX', checkoutRef: 'FANREF1', nowMs: 1_000 });
    expect(() =>
      applyCheckoutLocked(state, { listingId: 'lst_001', buyerHandle: 'rival', paymentMethod: 'PIX', checkoutRef: 'FANREF2', nowMs: 2_000 })
    ).toThrow(MarketError);

    const receipt = applyPaymentSettled(state, {
      listingId: 'lst_001',
      buyerHandle: 'buyer_whale',
      paymentMethod: 'PIX',
      paidAmountInteger: 25_100n,
      externalTxRef: 'E18236120202610161200ABCD',
      settledAtIso: '2026-10-16T12:01:00.000Z',
    });
    expect(receipt.platformFeeInteger).toBe(625n);
    expect(receipt.sellerNetPayoutInteger).toBe(24_375n);
    expect(receipt.excessToRefundInteger).toBe(100n);
    expect(state.lands[1]).toMatchObject({ ownerHandle: 'buyer_whale', minterHandle: 'seller_pro' });
    expect(state.plotIndexByMinter.get('seller_pro')).toBe(1);
    expect(state.reputationXpByHandle.get('seller_pro')).toBe(100);
    expect(state.reputationXpByHandle.has('buyer_whale')).toBe(false);
  });

  it('refuses underpayment, method mismatch and a replayed payment reference', () => {
    const state = cityWithSeller();
    applyCheckoutLocked(state, { listingId: 'lst_001', buyerHandle: 'buyer', paymentMethod: 'BTC', checkoutRef: 'FANREF3', nowMs: 1_000 });
    const proof = { listingId: 'lst_001', buyerHandle: 'buyer', paymentMethod: 'BTC' as const, paidAmountInteger: 41_000n, externalTxRef: 'txid_0001_btc', settledAtIso: 'x' };
    expect(() => applyPaymentSettled(state, proof)).toThrow(/Underpaid/);
    expect(() => applyPaymentSettled(state, { ...proof, paymentMethod: 'PIX', paidAmountInteger: 25_000n })).toThrow(/does not match/);
    applyPaymentSettled(state, { ...proof, paidAmountInteger: 41_666n });
    expect(() => applyPaymentSettled(state, { ...proof, paidAmountInteger: 41_666n })).toThrow(/already applied/);
  });

  it('escrows token packs at listing time', () => {
    const state = createCityState();
    applyCommentEvent(state, comment('holder', '@badbunnypr'));
    applyListingCreated(state, {
      listingId: 'pack_1', sellerHandle: 'holder', assetType: 'FANT_PACK', plotIndex: null,
      tokenAmountMicro: 600_000_000n, priceBrlCents: 1_000n, priceUsdtMicro: 1n, priceBtcSats: 1n, nowIso: 'x',
    });
    // 900 $FANT from the joining pack, 600 escrowed in the listing.
    expect(state.tokenBalancesMicro.get('holder')).toBe(300_000_000n);
    expect(() =>
      applyListingCreated(state, {
        listingId: 'pack_2', sellerHandle: 'holder', assetType: 'FANT_PACK', plotIndex: null,
        tokenAmountMicro: 600_000_000n, priceBrlCents: 1_000n, priceUsdtMicro: 1n, priceBtcSats: 1n, nowIso: 'x',
      })
    ).toThrow(/Insufficient/);
  });

  it('lets one @ hold many bought deeds, never a second mint, and wipes the lot ad on sale', () => {
    const state = createCityState();
    applyCommentEvent(state, comment('seller_a', '@taylorswift'));
    applyCommentEvent(state, comment('seller_b', '@realmadrid'));
    applyCommentEvent(state, comment('seller_a', '@taylorswift', 'post_again'));
    expect(state.lands.filter((land) => land.minterHandle === 'seller_a')).toHaveLength(1);
    expect(plotsOwnedBy(state, 'seller_a')).toEqual([state.plotIndexByMinter.get('seller_a')]);

    const sell = (listingId: string, seller: string, plotIndex: number, tx: string): void => {
      applyListingCreated(state, {
        listingId,
        sellerHandle: seller,
        assetType: 'LAND_PLOT',
        plotIndex,
        tokenAmountMicro: null,
        priceBrlCents: 10_000n,
        priceUsdtMicro: 1n,
        priceBtcSats: 1n,
        nowIso: '2026-10-16T12:00:00.000Z',
      });
      applyCheckoutLocked(state, { listingId, buyerHandle: 'whale', paymentMethod: 'PIX', checkoutRef: listingId, nowMs: 1_000 });
      applyPaymentSettled(state, {
        listingId,
        buyerHandle: 'whale',
        paymentMethod: 'PIX',
        paidAmountInteger: 10_000n,
        externalTxRef: tx,
        settledAtIso: '2026-10-16T12:01:00.000Z',
      });
    };

    const homeA = state.plotIndexByMinter.get('seller_a') ?? -1;
    applyLotAdSet(state, homeA, 'seller_a', { headline: 'Visit the cafe', tagline: 'Open late', backgroundHex: '#112233', accentHex: '#FFFFFF' });
    expect(state.lotAds.get(homeA)?.headline).toBe('Visit the cafe');
    expect(() => applyLotAdSet(state, homeA, 'whale', { headline: 'Stolen', tagline: 'Nope', backgroundHex: '#000000', accentHex: '#FFFFFF' })).toThrow(LotAdError);
    expect(() => applyLotAdSet(state, homeA, 'seller_a', { headline: '<script>', tagline: 'Open late', backgroundHex: '#112233', accentHex: '#FFFFFF' })).toThrow(LotAdError);

    sell('lst_a', 'seller_a', homeA, 'txid_bank_a');
    sell('lst_b', 'seller_b', state.plotIndexByMinter.get('seller_b') ?? -1, 'txid_bank_b');
    expect(homesOwnedBy(state, 'whale')).toBe(2);
    expect(homesOwnedBy(state, 'seller_a')).toBe(0);
    expect(state.plotIndexByMinter.get('seller_a')).toBe(homeA);
    expect(state.lotAds.has(homeA)).toBe(false);
  });
});

describe('PIX BR Code', () => {
  it('implements CRC16/CCITT-FALSE (check value and BACEN manual example)', () => {
    expect(crc16CcittFalse('123456789')).toBe('29B1');
    const bacenExample =
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
    expect(crc16CcittFalse(bacenExample)).toBe('1D3D');
  });

  it('builds a self-consistent payload with amount and txid', () => {
    const code = buildPixBrCode({
      pixKey: '00000000-0000-0000-0000-000000000000',
      amountBrlCents: 25_000n,
      merchantName: 'Fanation Club',
      merchantCity: 'São Paulo',
      txid: 'FAN1234ABCD',
    });
    expect(code).toContain('5406250.00');
    expect(code).toContain('6009SAO PAULO');
    expect(code.slice(-4)).toBe(crc16CcittFalse(code.slice(0, -4)));
  });
});

describe('Meta webhook boundary', () => {
  const secret = 'meta_app_secret_for_tests_2026';

  it('verifies X-Hub-Signature-256 and the subscription handshake', () => {
    const raw = Buffer.from('{"object":"instagram"}');
    const sig = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    expect(verifyMetaSignature(secret, raw, sig)).toBe(true);
    expect(verifyMetaSignature(secret, raw, 'sha256=00')).toBe(false);
    const params = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok_123', 'hub.challenge': '987654' });
    expect(resolveSubscriptionChallenge(params, 'tok_123')).toBe('987654');
    expect(resolveSubscriptionChallenge(params, 'other')).toBeNull();
  });

  it('parses both body shapes and skips replies', () => {
    const value = (id: string, extra: Record<string, unknown> = {}) => ({
      id, text: '@taylorswift', from: { id: '1', username: 'ana' }, media: { id: 'm1', media_product_type: 'FEED' }, ...extra,
    });
    const events = parseMetaCommentWebhook({
      object: 'instagram',
      entry: [
        { id: 'ig', time: 1_760_000_000, changes: [{ field: 'comments', value: value('c1') }, { field: 'comments', value: value('c2', { parent_id: 'c1' }) }] },
        { id: 'ig', time: 1_760_000_001, field: 'comments', value: value('c3') },
      ],
    });
    expect(events.map((e) => e.commentId)).toEqual(['c1', 'c3']);
    expect(events[0]).toMatchObject({ mediaId: 'm1', authorUsername: 'ana', receivedAtMs: 1_760_000_000_000 });
  });
});

describe('Graph API collector', () => {
  it('pages through comments, skips unchanged posts and refuses foreign paging URLs', async () => {
    const calls: string[] = [];
    let commentsCount = 3;
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes('/me_ig/media')) {
        return json({ data: [{ id: 'm1', timestamp: '2026-10-16T00:00:00+0000', comments_count: commentsCount }] });
      }
      if (url.includes('after=p2')) {
        return json({ data: [{ id: 'c3', text: '@realmadrid', username: 'c', timestamp: '2026-10-16T00:00:03+0000' }] });
      }
      return json({
        data: [
          { id: 'c1', text: '@realmadrid', username: 'a', timestamp: '2026-10-16T00:00:01+0000' },
          { id: 'c2', text: '@taylorswift', username: 'b', timestamp: '2026-10-16T00:00:02+0000' },
        ],
        paging: { next: 'https://graph.facebook.com/v23.0/m1/comments?after=p2' },
      });
    }) as typeof fetch;

    const source = new GraphCommentSource({ graphBaseUrl: 'https://graph.facebook.com/v23.0', igUserId: 'me_ig', accessToken: 't', mediaLimit: 10, fetchImpl: fakeFetch });
    expect((await source.fetchComments()).map((e) => e.commentId)).toEqual(['c1', 'c2', 'c3']);
    expect(calls.every((u) => new URL(u).searchParams.getAll('access_token').join() === 't')).toBe(true);

    const headerCalls: string[] = [];
    const viaHeader = new GraphCommentSource({
      graphBaseUrl: 'https://graph.facebook.com/v23.0', igUserId: 'me_ig', accessToken: 't', mediaLimit: 10, tokenTransport: 'header',
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        headerCalls.push(String(input));
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer t');
        return fakeFetch(input, init);
      }) as typeof fetch,
    });
    await viaHeader.fetchComments();
    expect(headerCalls.every((u) => !u.includes('access_token'))).toBe(true);

    calls.length = 0;
    expect(await source.fetchComments()).toEqual([]);
    expect(calls).toHaveLength(1);

    commentsCount = 4;
    const evil = new GraphCommentSource({
      graphBaseUrl: 'https://graph.facebook.com/v23.0', igUserId: 'me_ig', accessToken: 't', mediaLimit: 10,
      fetchImpl: (async (input: string | URL | Request) =>
        new Response(JSON.stringify(String(input).includes('/media')
          ? { data: [{ id: 'm1', comments_count: 1 }] }
          : { data: [], paging: { next: 'https://evil.example/steal' } }), { status: 200 })) as typeof fetch,
    });
    await expect(evil.fetchComments()).rejects.toThrow(/Refusing to follow/);
  });
});

describe('city service and journal replay', () => {
  it('applies a batch earliest-first, skips re-reads without journaling, and replays to the same city', () => {
    const journal = new MemoryEventJournal();
    const live = new CityService(DEFAULT_LEDGER_CONFIG, journal, (err) => { throw err; });
    live.boot();

    const late = { ...comment('late_fan', '@taylorswift'), receivedAtMs: 2_000 };
    const early = { ...comment('early_fan', '@realmadrid'), receivedAtMs: 1_000 };
    live.ingestComments([late, early], 'instagram_poll');
    live.ingestComments([late, early], 'instagram_poll');

    const homeOf = (handle: string) => live.stateView.plotIndexByMinter.get(handle) ?? Number.POSITIVE_INFINITY;
    expect(homeOf('early_fan')).toBeLessThan(homeOf('late_fan'));
    expect(journal.records).toHaveLength(2);
    expect(live.journalSources.has('instagram_poll')).toBe(true);

    const replayed = new CityService(DEFAULT_LEDGER_CONFIG, journal, (err) => { throw err; });
    replayed.boot();
    const strip = (s: ReturnType<CityService['summary']>) => ({ ...s, generatedAtIso: '' });
    expect(strip(replayed.summary(10_000))).toEqual(strip(live.summary(10_000)));
    const keys = live.summary(10_000).chunks.map((c) => c.key);
    expect(replayed.chunksByKey(keys)).toEqual(live.chunksByKey(keys));
    expect(live.changesSince(0).properties.length).toBe(live.stateView.lands.length);
    expect(computeCityStandings(replayed.stateView as CityState)[0].fandomHandle).toBe('realmadrid');
  });

  it('starts empty and ignores comments from before the planet opened', () => {
    const journal = new MemoryEventJournal();
    const openedAt = 5_000;
    const city = new CityService(DEFAULT_LEDGER_CONFIG, journal, (err) => { throw err; }, undefined, openedAt);
    expect(city.boot()).toBe(0);
    expect(city.stateView.lands).toHaveLength(0);

    city.ingestComments([{ ...comment('old_fan', '@taylorswift'), receivedAtMs: 1_000 }], 'instagram_poll');
    expect(city.stateView.lands).toHaveLength(0);

    city.ingestComments([{ ...comment('first_owner', '@taylorswift'), receivedAtMs: 6_000 }], 'instagram_poll');
    expect(city.stateView.lands.map((land) => land.minterHandle)).toEqual(['taylorswift', 'first_owner']);
  });
});
