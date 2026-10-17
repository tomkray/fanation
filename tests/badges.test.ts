/**
 * Captain tags (A12): fan #1 of an idol gets that idol's tag, once, forever.
 * The tag is an asset: the holder can give it away or sell it through the
 * escrowed checkout; while it is for sale it cannot be given away.
 */

import { describe, expect, it } from 'vitest';
import { InstagramCommentEvent } from '../src/core/types.js';
import { CityService } from '../src/infrastructure/cityService.js';
import { MemoryEventJournal } from '../src/infrastructure/persistence/eventJournal.js';

const START = 1_800_000_000_000;
let n = 0;
function comment(author: string, text: string, media = 'ig_post1'): InstagramCommentEvent {
  n += 1;
  return { commentId: `b${n}`, mediaId: media, text, authorUsername: author, authorId: null, receivedAtMs: START + n * 61_000 };
}

function city(journal = new MemoryEventJournal()): CityService {
  const c = new CityService({ officialAccountHandle: 'naoeumfa', layoutEpochMs: null, seasonLengthMs: null }, journal, (err) => {
    throw err;
  });
  c.boot();
  return c;
}

describe('captain tags', () => {
  it('go to the fan who brought the idol in, once per idol', () => {
    const c = city();
    const [first] = c.ingestComments([comment('ana', '@anitta')], 'instagram_webhook');
    const [second] = c.ingestComments([comment('ben', '@anitta')], 'instagram_webhook');
    expect(first).toMatchObject({ status: 'MINTED_NEW_LAND', becameCaptain: true });
    expect(second).toMatchObject({ status: 'MINTED_NEW_LAND', becameCaptain: false });
    // Ana naming anitta again on another post does not mint a second tag.
    c.ingestComments([comment('ana', '@anitta', 'ig_post2')], 'instagram_webhook');
    expect([...c.stateView.founderBadges.values()]).toEqual([
      expect.objectContaining({ idolHandle: 'anitta', founderHandle: 'ana', holderHandle: 'ana' }),
    ]);
    expect(c.summary().standings.find((s) => s.fandomHandle === 'anitta')?.captainHandle).toBe('ana');
    expect(c.me('ana').badges.map((b) => b.idolHandle)).toEqual(['anitta']);
    expect(c.profileDetail('ana')?.captainOf).toEqual(['anitta']);
  });

  it('can be given away only by the holder, never to yourself or the official account', () => {
    const c = city();
    c.ingestComments([comment('ana', '@anitta'), comment('ben', '@anitta')], 'instagram_webhook');
    expect(() => c.transferBadge('ben', 'anitta', 'ben2')).toThrow(/does not hold/);
    expect(() => c.transferBadge('ana', 'anitta', 'ana')).toThrow(/already hold/);
    expect(() => c.transferBadge('ana', 'anitta', 'naoeumfa')).toThrow(/official account/);
    expect(() => c.transferBadge('ana', 'nobody', 'ben')).toThrow(/no captain tag/);
    expect(c.transferBadge('ana', 'anitta', 'ben')).toMatchObject({ holderHandle: 'ben', founderHandle: 'ana' });
    expect(c.summary().standings.find((s) => s.fandomHandle === 'anitta')?.captainHandle).toBe('ben');
  });

  it('sells through the escrowed checkout and cannot be given away while for sale', () => {
    const journal = new MemoryEventJournal();
    const c = city(journal);
    c.ingestComments([comment('ana', '@anitta'), comment('ben', '@anitta')], 'instagram_webhook');
    expect(() => c.listBadge('ben', 'anitta', 10_000n)).toThrow(/does not hold/);
    const listing = c.listBadge('ana', 'anitta', 10_000n);
    expect(() => c.listBadge('ana', 'anitta', 12_000n)).toThrow(/already for sale/);
    expect(() => c.transferBadge('ana', 'anitta', 'ben')).toThrow(/Cancel the sale/);
    expect(c.me('ana').badges[0].listingId).toBe(listing.listingId);

    expect(() => c.lockCheckout({ listingId: listing.listingId, buyerHandle: 'ana', paymentMethod: 'PIX', checkoutRef: 'ck0', nowMs: START })).toThrow(/Buyer cannot be the seller/);
    c.lockCheckout({ listingId: listing.listingId, buyerHandle: 'ben', paymentMethod: 'PIX', checkoutRef: 'ck1', nowMs: START });
    expect(() =>
      c.settlePayment({ listingId: listing.listingId, buyerHandle: 'ben', paymentMethod: 'PIX', paidAmountInteger: 9_999n, externalTxRef: 'PIX-BADGE-01', settledAtIso: '' })
    ).toThrow(/Underpaid/);
    c.settlePayment({ listingId: listing.listingId, buyerHandle: 'ben', paymentMethod: 'PIX', paidAmountInteger: 10_000n, externalTxRef: 'PIX-BADGE-01', settledAtIso: '' });

    const badge = c.stateView.founderBadges.get('anitta');
    expect(badge).toMatchObject({ holderHandle: 'ben', founderHandle: 'ana' });
    expect(c.me('ana').badges).toEqual([]);
    expect(c.me('ben').badges[0]).toMatchObject({ idolHandle: 'anitta', listingId: null });
    expect(() => c.listBadge('ana', 'anitta', 1_000n)).toThrow(/does not hold/);

    // The book rebuilds the same tags from the journal alone.
    expect([...city(journal).stateView.founderBadges.values()]).toEqual([...c.stateView.founderBadges.values()]);
  });
});
