/**
 * Login + wallet (A10): a Direct login link signs in once, before it
 * expires; sessions survive a restart; $NEFA transfers, listing cancellations
 * and offers are ledger events with integer amounts.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCommentEvent, applyLedgerEvent, createCityState, OfferError } from '../src/core/cityLedger.js';
import { InstagramCommentEvent } from '../src/core/types.js';
import { AuthService, LOGIN_LINK_TTL_MS, LOGIN_TOKEN_PATTERN } from '../src/infrastructure/auth/authService.js';

function commentBy(author: string, text: string, id: string): InstagramCommentEvent {
  return { commentId: id, mediaId: 'p1', text, authorUsername: author, authorId: null, receivedAtMs: 1 };
}

function tempFile(name: string): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'naoeumfa-wallet-')), name);
}

describe('login link from Direct', () => {
  it('signs in once, survives a restart, and dies after use or 10 minutes', () => {
    let now = 1_800_000_000_000;
    const file = tempFile('sessions.json');
    const auth = new AuthService(file, () => now);
    const token = auth.createLoginLink('alice.fan', '17841400000000001');
    expect(token).toMatch(LOGIN_TOKEN_PATTERN);

    // Peeking shows who the link is for without using it.
    expect(auth.peekLoginLink(token)).toBe('alice.fan');
    expect(auth.peekLoginLink(`${token.slice(0, -1)}A`)).toBeNull();
    expect(auth.peekLoginLink('NEFA-ABC234')).toBeNull();

    const signedIn = auth.redeemLoginLink(token);
    expect(signedIn?.handle).toBe('alice.fan');
    expect(auth.sessionHandle(signedIn?.sessionToken)).toBe('alice.fan');
    // Single use: the same link cannot open a second session.
    expect(auth.redeemLoginLink(token)).toBeNull();

    const restarted = new AuthService(file, () => now);
    expect(restarted.sessionHandle(signedIn?.sessionToken)).toBe('alice.fan');
    restarted.revoke(signedIn?.sessionToken);
    expect(restarted.sessionHandle(signedIn?.sessionToken)).toBeNull();

    const late = auth.createLoginLink('alice.fan', '17841400000000001');
    now += LOGIN_LINK_TTL_MS + 1;
    expect(auth.redeemLoginLink(late)).toBeNull();
  });

  it('keeps at most three live links per @', () => {
    let now = 1_800_000_000_000;
    const auth = new AuthService(tempFile('s.json'), () => now);
    const links = [0, 1, 2, 3].map(() => {
      now += 1;
      return auth.createLoginLink('bob', '1');
    });
    expect(auth.peekLoginLink(links[0])).toBeNull();
    expect(links.slice(1).every((l) => auth.peekLoginLink(l) === 'bob')).toBe(true);
  });
});

describe('wallet ledger events', () => {
  it('sends $NEFA in integers, refuses overdrafts and self-sends', () => {
    const state = createCityState();
    applyCommentEvent(state, commentBy('ana', '@taylorswift', 'w1'));
    const send = (amount: bigint, to = 'ben') =>
      applyLedgerEvent(state, { kind: 'token_transferred', transfer: { transferId: `t${amount}`, fromHandle: 'ana', toHandle: to, amountMicro: amount, atIso: '' } });
    send(25_000_000n);
    expect(state.tokenBalancesMicro.get('ana')).toBe(875_000_000n);
    expect(state.tokenBalancesMicro.get('ben')).toBe(25_000_000n);
    expect(() => send(900_000_000n)).toThrow(/negative/);
    expect(() => send(1n, 'ana')).toThrow(/yourself/);
    expect(() => send(0n)).toThrow(/positive/);
  });

  it('lets only the seller cancel an open listing', () => {
    const state = createCityState();
    applyCommentEvent(state, commentBy('seller', '@realmadrid', 'w2'));
    const plot = state.plotIndexByMinter.get('seller') ?? -1;
    applyLedgerEvent(state, {
      kind: 'listing_created',
      input: { listingId: 'lst_a', sellerHandle: 'seller', assetType: 'LAND_PLOT', plotIndex: plot, tokenAmountMicro: null, priceBrlCents: 5_000n, priceUsdtMicro: 9_000_000n, priceBtcSats: 8_000n, nowIso: '' },
    });
    expect(() => applyLedgerEvent(state, { kind: 'listing_cancelled', listingId: 'lst_a', sellerHandle: 'intruder' })).toThrow(/did not create/);
    applyLedgerEvent(state, { kind: 'listing_cancelled', listingId: 'lst_a', sellerHandle: 'seller' });
    expect(state.listings.get('lst_a')?.status).toBe('CANCELLED');
  });
});

describe('offers in the ledger', () => {
  function city(): { state: ReturnType<typeof createCityState>; plot: number } {
    const state = createCityState();
    applyCommentEvent(state, commentBy('owner', '@realmadrid', 'o1'));
    return { state, plot: state.plotIndexByMinter.get('owner') ?? -1 };
  }
  const offer = (plotIndex: number, fromHandle: string, amountBrlCents: bigint, offerId: string) =>
    ({ kind: 'offer_made', offer: { offerId, plotIndex, fromHandle, amountBrlCents, atIso: '' } }) as const;
  const listing = (plotIndex: number, sellerHandle: string, priceBrlCents: bigint) => ({
    listingId: 'lst_off',
    sellerHandle,
    assetType: 'LAND_PLOT' as const,
    plotIndex,
    tokenAmountMicro: null,
    priceBrlCents,
    priceUsdtMicro: 1n,
    priceBtcSats: 1n,
    nowIso: '',
  });

  it('keeps one open bid per bidder per property and refuses bids on your own home', () => {
    const { state, plot } = city();
    applyLedgerEvent(state, offer(plot, 'bidder', 10_000n, 'off_1'));
    applyLedgerEvent(state, offer(plot, 'bidder', 15_000n, 'off_2'));
    expect(state.offers.get('off_1')?.status).toBe('WITHDRAWN');
    expect(state.offers.get('off_2')).toMatchObject({ status: 'PENDING', toHandle: 'owner' });
    expect(() => applyLedgerEvent(state, offer(plot, 'owner', 10_000n, 'off_3'))).toThrow(OfferError);
    expect(() => applyLedgerEvent(state, offer(plot, 'bidder', 50n, 'off_4'))).toThrow(/between/);
    expect(() => applyLedgerEvent(state, offer(9_999, 'bidder', 10_000n, 'off_5'))).toThrow(/does not exist/);
  });

  it('lets only the owner decide, and only the bidder withdraw', () => {
    const { state, plot } = city();
    applyLedgerEvent(state, offer(plot, 'bidder', 15_000n, 'off_1'));
    expect(() => applyLedgerEvent(state, { kind: 'offer_declined', offerId: 'off_1', ownerHandle: 'bidder' })).toThrow(OfferError);
    expect(() => applyLedgerEvent(state, { kind: 'offer_withdrawn', offerId: 'off_1', bidderHandle: 'owner' })).toThrow(OfferError);
    applyLedgerEvent(state, { kind: 'offer_declined', offerId: 'off_1', ownerHandle: 'owner' });
    expect(state.offers.get('off_1')?.status).toBe('DECLINED');
    expect(() => applyLedgerEvent(state, { kind: 'offer_withdrawn', offerId: 'off_1', bidderHandle: 'bidder' })).toThrow(/already declined/);
  });

  it('accepts and lists at exactly the offered price in one event, or changes nothing', () => {
    const { state, plot } = city();
    applyLedgerEvent(state, offer(plot, 'bidder', 15_000n, 'off_1'));
    const accept = (input: ReturnType<typeof listing>, ownerHandle = 'owner') =>
      () => applyLedgerEvent(state, { kind: 'offer_accepted', offerId: 'off_1', ownerHandle, listing: input });

    expect(accept(listing(plot, 'owner', 1n))).toThrow(/offered price/);
    expect(accept(listing(plot, 'owner', 15_000n), 'bidder')).toThrow(OfferError);
    expect(state.offers.get('off_1')?.status).toBe('PENDING');
    expect(state.listings.size).toBe(0);

    accept(listing(plot, 'owner', 15_000n))();
    expect(state.offers.get('off_1')).toMatchObject({ status: 'ACCEPTED', listingId: 'lst_off' });
    expect(state.listings.get('lst_off')).toMatchObject({ status: 'OPEN', priceBrlCents: 15_000n, sellerHandle: 'owner' });
  });
});
