/**
 * Login + wallet (A10): a Direct login link signs in once, before it
 * expires; sessions survive a restart; $NEFA transfers and listing
 * cancellations are ledger events with integer amounts.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCommentEvent, applyLedgerEvent, createCityState } from '../src/core/cityLedger.js';
import { InstagramCommentEvent } from '../src/core/types.js';
import { AuthService, LOGIN_LINK_TTL_MS, LOGIN_TOKEN_PATTERN } from '../src/infrastructure/auth/authService.js';
import { OfferError, OfferService } from '../src/infrastructure/market/offerService.js';

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

describe('offers', () => {
  it('keeps one open offer per bidder per property and lets only the owner decide', () => {
    const offers = new OfferService(tempFile('offers.json'));
    offers.make({ plotIndex: 3, fromHandle: 'bidder', toHandle: 'owner', amountBrlCents: 10_000n });
    const second = offers.make({ plotIndex: 3, fromHandle: 'bidder', toHandle: 'owner', amountBrlCents: 15_000n });
    expect(offers.pendingCount(3)).toBe(1);
    expect(() => offers.decide(second.id, 'bidder', 'ACCEPTED')).toThrow(OfferError);
    expect(offers.decide(second.id, 'owner', 'DECLINED').status).toBe('DECLINED');
    expect(() => offers.make({ plotIndex: 3, fromHandle: 'owner', toHandle: 'owner', amountBrlCents: 10_000n })).toThrow(/already yours/);
  });
});
