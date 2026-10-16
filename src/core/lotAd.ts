/**
 * A billboard on a home the owner actually holds (Axiom A1 bank). Text and
 * colours only — the game draws it on the title deed, so nothing foreign is
 * loaded. Selling the home wipes the ad; the next owner starts blank.
 */

import { AD_HEADLINE_MAX, AD_TAGLINE_MAX, sanitizeAdText } from './ads.js';

export interface LotAd {
  readonly headline: string;
  readonly tagline: string;
  readonly backgroundHex: string;
  readonly accentHex: string;
}

export class LotAdError extends Error {
  constructor(
    readonly code: 'NOT_OWNER' | 'NO_SUCH_PLOT' | 'INVALID_CREATIVE',
    message: string
  ) {
    super(message);
    this.name = 'LotAdError';
  }
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Hostile input: same text and colour rules as city-wide partner ads. */
export function validateLotAd(input: unknown): LotAd {
  if (typeof input !== 'object' || input === null) {
    throw new LotAdError('INVALID_CREATIVE', 'Body must be a JSON object.');
  }
  const body = input as Record<string, unknown>;
  const headline = sanitizeAdText(body.headline, AD_HEADLINE_MAX, 'headline');
  if (typeof headline !== 'string') {
    throw new LotAdError('INVALID_CREATIVE', headline.error);
  }
  const tagline = sanitizeAdText(body.tagline, AD_TAGLINE_MAX, 'tagline');
  if (typeof tagline !== 'string') {
    throw new LotAdError('INVALID_CREATIVE', tagline.error);
  }
  const backgroundHex = body.backgroundHex;
  const accentHex = body.accentHex;
  if (typeof backgroundHex !== 'string' || !HEX.test(backgroundHex) || typeof accentHex !== 'string' || !HEX.test(accentHex)) {
    throw new LotAdError('INVALID_CREATIVE', 'Colours must be #RRGGBB.');
  }
  return {
    headline,
    tagline,
    backgroundHex: backgroundHex.toUpperCase(),
    accentHex: accentHex.toUpperCase(),
  };
}
