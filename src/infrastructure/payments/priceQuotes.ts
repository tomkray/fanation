/**
 * A listing is priced in BRL; the USDT and BTC prices are derived with
 * reference rates (integer math only, A5). Rates are fixed reference values
 * until a price feed is wired; checkout always charges the derived integer.
 */

/** Reference FX: 1 USD = R$ 5,40 and 1 BTC = R$ 600.000. */
const BRL_CENTS_PER_USD = 540n;
const BRL_CENTS_PER_BTC = 60_000_000n;

export function usdMicroFromBrlCents(cents: bigint): bigint {
  return (cents * 1_000_000n) / BRL_CENTS_PER_USD;
}

export function satsFromBrlCents(cents: bigint): bigint {
  return (cents * 100_000_000n) / BRL_CENTS_PER_BTC;
}
