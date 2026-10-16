/**
 * Demo-only: some fans put their home up for sale so the marketplace has
 * something to show. Prices follow the property class (fans make value) and
 * use fixed demo FX rates.
 */

import { propertyClassOf } from '../../core/cityLedger.js';
import { MarketError } from '../../core/marketplace.js';
import { PropertyClass } from '../../core/property.js';
import { logger } from '../../utils/logger.js';
import { CityService } from '../cityService.js';
import { satsFromBrlCents, usdMicroFromBrlCents } from '../payments/priceQuotes.js';

const PRICE_BRL_CENTS_BY_CLASS: Readonly<Record<PropertyClass, bigint>> = {
  COTTAGE: 6_000n,
  HOUSE: 12_000n,
  TOWNHOUSE: 25_000n,
  VILLA: 60_000n,
  TOWER: 150_000n,
  SKYSCRAPER: 600_000n,
  MEGATOWER: 2_500_000n,
  LANDMARK: 5_000_000n,
};

const MAX_OPEN_DEMO_LISTINGS = 8;

export function maybeCreateDemoListings(city: CityService, nowMs: number): void {
  const state = city.stateView;
  const open = Array.from(state.listings.values()).filter((l) => l.status === 'OPEN' || l.status === 'LOCKED_ESCROW');
  if (open.length >= MAX_OPEN_DEMO_LISTINGS || state.lands.length < 6) {
    return;
  }
  const everListedPlots = new Set(Array.from(state.listings.values(), (l) => l.plotIndex));
  // Deterministic pick: every 5th home still held by the fan who built it and never listed.
  const candidate = state.lands.find(
    (land) =>
      land.plotIndex % 5 === 1 &&
      land.idolHandle !== null &&
      land.ownerHandle === land.minterHandle &&
      !everListedPlots.has(land.plotIndex)
  );
  if (!candidate) {
    return;
  }

  const priceBrlCents = PRICE_BRL_CENTS_BY_CLASS[propertyClassOf(state, candidate)];
  try {
    city.createListing({
      listingId: `lst_${candidate.plotIndex}_${nowMs.toString(36)}`,
      sellerHandle: candidate.ownerHandle,
      assetType: 'LAND_PLOT',
      plotIndex: candidate.plotIndex,
      tokenAmountMicro: null,
      priceBrlCents,
      priceUsdtMicro: usdMicroFromBrlCents(priceBrlCents),
      priceBtcSats: satsFromBrlCents(priceBrlCents),
      nowIso: new Date(nowMs).toISOString(),
    });
  } catch (err) {
    if (err instanceof MarketError) {
      logger.warn('demo_listing_skipped', { code: err.code, plotIndex: candidate.plotIndex });
      return;
    }
    throw err;
  }
}
