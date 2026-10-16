/**
 * Partner advertising inside the world (Axiom A9). Partners book a placement —
 * a zeppelin over a city, a billboard inside a city (never on the avenues), or a banner towed
 * across the sky — with a short creative that the game draws itself (text and
 * colours only, so nothing foreign is ever loaded into the 3D scene). Every
 * campaign is reviewed before it flies; prices are integer BRL cents.
 */

import { normalizeInstagramHandle } from './antiFraud.js';
import type { CityId } from './cities.js';

export type AdPlacement = 'ZEPPELIN' | 'BILLBOARD' | 'SKY_BANNER';
export const AD_PLACEMENTS: readonly AdPlacement[] = ['ZEPPELIN', 'BILLBOARD', 'SKY_BANNER'];

export type AdStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

/** Price per day, BRL cents. */
export const AD_RATE_CARD_CENTS_PER_DAY: Readonly<Record<AdPlacement, bigint>> = {
  ZEPPELIN: 150_000n,
  SKY_BANNER: 80_000n,
  BILLBOARD: 40_000n,
};

export const AD_MAX_DAYS = 90;
export const AD_HEADLINE_MAX = 28;
export const AD_TAGLINE_MAX = 44;

export type AdCity = CityId | 'ALL';
const AD_CITIES: readonly AdCity[] = ['ALL', 'CAPITAL', 'MUSIC', 'SPORTS', 'CREATORS', 'COMMUNITY'];

export interface AdCreative {
  readonly headline: string;
  readonly tagline: string;
  /** The partner's real Instagram @, always printed on the ad. */
  readonly partnerHandle: string;
  readonly backgroundHex: string;
  readonly accentHex: string;
}

export interface AdRequest {
  readonly placement: AdPlacement;
  readonly city: AdCity;
  readonly days: number;
  readonly creative: AdCreative;
  /** Where the team replies; never shown publicly. */
  readonly contactEmail: string;
}

export interface AdCampaign extends AdRequest {
  readonly id: string;
  readonly status: AdStatus;
  readonly quoteBrlCents: bigint;
  readonly createdAtIso: string;
  /** Set on approval: the campaign flies from then for `days` days. */
  readonly startsAtIso: string | null;
  /** Não É Um Fã's own "advertise here" inventory, shown when a slot is unsold. */
  readonly house: boolean;
}

export type AdValidation = { readonly ok: true; readonly request: AdRequest } | { readonly ok: false; readonly error: string };

const HEX = /^#[0-9a-f]{6}$/i;
const EMAIL = /^[^\s@<>"']{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;
/** Control characters, bidi overrides and zero-width tricks can make a creative lie about itself. */
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff<>]/;

/** Shared with lot ads on title deeds (A1 bank). */
export function sanitizeAdText(value: unknown, max: number, field: string): string | { readonly error: string } {
  if (typeof value !== 'string') {
    return { error: `${field} is required.` };
  }
  const text = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (text.length === 0 || [...text].length > max) {
    return { error: `${field} must be 1–${max} characters.` };
  }
  if (UNSAFE_TEXT.test(text)) {
    return { error: `${field} contains characters that are not allowed.` };
  }
  return text;
}

/** Every field from the outside world is hostile until it passes here. */
export function validateAdRequest(input: unknown): AdValidation {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Body must be a JSON object.' };
  }
  const body = input as Record<string, unknown>;
  const placement = body.placement;
  if (typeof placement !== 'string' || !(AD_PLACEMENTS as readonly string[]).includes(placement)) {
    return { ok: false, error: `placement must be one of ${AD_PLACEMENTS.join(', ')}.` };
  }
  const city = body.city ?? 'ALL';
  if (typeof city !== 'string' || !(AD_CITIES as readonly string[]).includes(city)) {
    return { ok: false, error: `city must be one of ${AD_CITIES.join(', ')}.` };
  }
  const days = body.days;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > AD_MAX_DAYS) {
    return { ok: false, error: `days must be an integer from 1 to ${AD_MAX_DAYS}.` };
  }
  const creative = (typeof body.creative === 'object' && body.creative !== null ? body.creative : {}) as Record<string, unknown>;
  const headline = sanitizeAdText(creative.headline, AD_HEADLINE_MAX, 'headline');
  if (typeof headline !== 'string') {
    return { ok: false, error: headline.error };
  }
  const tagline = sanitizeAdText(creative.tagline, AD_TAGLINE_MAX, 'tagline');
  if (typeof tagline !== 'string') {
    return { ok: false, error: tagline.error };
  }
  const partnerHandle = typeof creative.partnerHandle === 'string' ? normalizeInstagramHandle(creative.partnerHandle) : null;
  if (!partnerHandle) {
    return { ok: false, error: 'partnerHandle must be a valid Instagram @handle.' };
  }
  const backgroundHex = creative.backgroundHex;
  const accentHex = creative.accentHex;
  if (typeof backgroundHex !== 'string' || !HEX.test(backgroundHex) || typeof accentHex !== 'string' || !HEX.test(accentHex)) {
    return { ok: false, error: 'Colours must be #RRGGBB.' };
  }
  const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim() : '';
  if (!EMAIL.test(contactEmail)) {
    return { ok: false, error: 'contactEmail must be a valid e-mail address.' };
  }
  return {
    ok: true,
    request: {
      placement: placement as AdPlacement,
      city: city as AdCity,
      days,
      contactEmail,
      creative: { headline, tagline, partnerHandle, backgroundHex: backgroundHex.toUpperCase(), accentHex: accentHex.toUpperCase() },
    },
  };
}

export function quoteAd(placement: AdPlacement, days: number): bigint {
  return AD_RATE_CARD_CENTS_PER_DAY[placement] * BigInt(days);
}

/** House ads always fly; partner campaigns fly from approval for their booked days. */
export function isAdLive(campaign: AdCampaign, nowMs: number): boolean {
  if (campaign.status !== 'APPROVED') {
    return false;
  }
  if (campaign.house) {
    return true;
  }
  if (campaign.startsAtIso === null) {
    return false;
  }
  const start = Date.parse(campaign.startsAtIso);
  return nowMs >= start && nowMs < start + campaign.days * 86_400_000;
}
