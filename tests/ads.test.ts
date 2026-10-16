/**
 * Partner ads (A9): hostile input is refused, quotes are integer cents, and a
 * request only flies after review; contact details never reach the public API.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { quoteAd, validateAdRequest } from '../src/core/ads.js';
import { AdService } from '../src/infrastructure/ads/adService.js';

const valid = {
  placement: 'ZEPPELIN',
  city: 'MUSIC',
  days: 7,
  contactEmail: 'brand@example.com',
  creative: { headline: 'NEON COLA', tagline: 'The drink of fandoms', partnerHandle: '@NeonCola', backgroundHex: '#3a0010', accentHex: '#FF375F' },
};

describe('ad requests', () => {
  it('accepts a clean request, normalising the @ and the colours', () => {
    const result = validateAdRequest(valid);
    expect(result).toMatchObject({
      ok: true,
      request: { placement: 'ZEPPELIN', city: 'MUSIC', days: 7, creative: { partnerHandle: 'neoncola', backgroundHex: '#3A0010' } },
    });
  });

  it('refuses bidi tricks, markup, bad colours, bad handles and impossible durations', () => {
    const bad = (patch: Record<string, unknown>, creative: Record<string, unknown> = {}) =>
      validateAdRequest({ ...valid, ...patch, creative: { ...valid.creative, ...creative } });
    expect(bad({}, { headline: 'SALE\u202E' }).ok).toBe(false);
    expect(bad({}, { tagline: '<script>x</script>' }).ok).toBe(false);
    expect(bad({}, { accentHex: 'red' }).ok).toBe(false);
    expect(bad({}, { partnerHandle: 'not a handle!' }).ok).toBe(false);
    expect(bad({}, { headline: 'x'.repeat(29) }).ok).toBe(false);
    expect(bad({ days: 0 }).ok).toBe(false);
    expect(bad({ days: 91 }).ok).toBe(false);
    expect(bad({ days: 2.5 }).ok).toBe(false);
    expect(bad({ placement: 'MOON' }).ok).toBe(false);
    expect(bad({ contactEmail: 'nope' }).ok).toBe(false);
    expect(validateAdRequest(null).ok).toBe(false);
  });

  it('quotes in integer BRL cents', () => {
    expect(quoteAd('ZEPPELIN', 7)).toBe(1_050_000n);
    expect(quoteAd('BILLBOARD', 1)).toBe(40_000n);
  });
});

describe('ad inventory', () => {
  it('flies only after approval, keeps contact e-mails private, and survives a restart', () => {
    let now = 1_800_000_000_000;
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'naoeumfa-ads-')), 'ads.json');
    const ads = new AdService(file, false, () => now);
    const result = validateAdRequest(valid);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const receipt = ads.request(result.request);
    expect(receipt).toMatchObject({ status: 'PENDING_REVIEW', quoteBrlCents: '1050000' });
    expect(ads.publicAds().campaigns.some((c) => c.id === receipt.id)).toBe(false);

    ads.review(receipt.id, 'APPROVED');
    const live = ads.publicAds();
    expect(live.campaigns[0]).toMatchObject({ id: receipt.id, partnerHandle: 'neoncola', house: false });
    expect(JSON.stringify(live)).not.toContain('brand@example.com');

    const reloaded = new AdService(file, false, () => now);
    expect(reloaded.publicAds().campaigns.some((c) => c.id === receipt.id)).toBe(true);
    now += 8 * 86_400_000;
    expect(reloaded.publicAds().campaigns.some((c) => c.id === receipt.id)).toBe(false);
    expect(reloaded.publicAds().campaigns.every((c) => c.house)).toBe(true);
  });
});
