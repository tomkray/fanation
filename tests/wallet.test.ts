/**
 * Connect + wallet (A10): a code only verifies the @ that comments it, once,
 * before it expires; sessions survive a restart; $FANT transfers and listing
 * cancellations are ledger events with integer amounts.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCommentEvent, applyLedgerEvent, createCityState } from '../src/core/cityLedger.js';
import { InstagramCommentEvent } from '../src/core/types.js';
import { AuthService, CHALLENGE_TTL_MS } from '../src/infrastructure/auth/authService.js';
import { OfferError, OfferService } from '../src/infrastructure/market/offerService.js';

function commentBy(author: string, text: string, id: string): InstagramCommentEvent {
  return { commentId: id, mediaId: 'p1', text, authorUsername: author, authorId: null, receivedAtMs: 1 };
}

function tempFile(name: string): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'fanation-wallet-')), name);
}

describe('connect with an Instagram comment', () => {
  it('verifies only when the code is commented by its own @, then opens one session', () => {
    let now = 1_800_000_000_000;
    const file = tempFile('sessions.json');
    const auth = new AuthService(file, () => now);
    const { code, secret } = auth.createChallenge('@Alice.Fan', 'ip-1');
    expect(code).toMatch(/^FAN-[2-9A-HJ-NP-Z]{6}$/);
    expect(auth.poll(secret).state).toBe('PENDING');

    auth.observeComments([commentBy('mallory', `${code} it's me!`, 'c1')]);
    expect(auth.poll(secret).state).toBe('PENDING');

    auth.observeComments([commentBy('alice.fan', `my code ${code.toLowerCase()}`, 'c2')]);
    const verified = auth.poll(secret);
    expect(verified).toMatchObject({ state: 'VERIFIED', handle: 'alice.fan' });
    expect(auth.sessionHandle(verified.sessionToken ?? '')).toBe('alice.fan');
    // Single use: the same browser secret cannot mint a second session.
    expect(auth.poll(secret).state).toBe('NONE');

    const restarted = new AuthService(file, () => now);
    expect(restarted.sessionHandle(verified.sessionToken ?? '')).toBe('alice.fan');
    restarted.revoke(verified.sessionToken ?? '');
    expect(restarted.sessionHandle(verified.sessionToken ?? '')).toBeNull();

    const late = auth.createChallenge('alice.fan', 'ip-1');
    now += CHALLENGE_TTL_MS + 1;
    auth.observeComments([commentBy('alice.fan', late.code, 'c3')]);
    expect(auth.poll(late.secret).state).toBe('EXPIRED');
  });

  it('limits how many codes one client can ask for', () => {
    const auth = new AuthService(tempFile('s.json'));
    for (let i = 0; i < 8; i += 1) {
      auth.createChallenge(`fan_${i}`, 'ip-9');
    }
    expect(() => auth.createChallenge('fan_x', 'ip-9')).toThrow(/Too many codes/);
  });
});

describe('wallet ledger events', () => {
  it('sends $FANT in integers, refuses overdrafts and self-sends', () => {
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
