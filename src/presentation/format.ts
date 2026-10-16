/**
 * Display formatting from integer strings. No floating point ever touches an
 * amount (Axiom A5); only the final text is localised (en-US grouping).
 */

import type { ArchitectureRarity } from '../core/architecture.js';
import { architectureOf } from '../core/architecture.js';
import type { PropertyClass, PropertyFootprint } from '../core/property.js';
import type { FandomCategory, PaymentMethod } from '../core/types.js';

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function splitUnits(raw: string, decimals: number): { whole: string; fraction: string } {
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toString();
  const fraction = (abs % base).toString().padStart(decimals, '0');
  return { whole: `${negative ? '-' : ''}${groupThousands(whole)}`, fraction };
}

export function formatBrlCents(raw: string): string {
  const { whole, fraction } = splitUnits(raw, 2);
  return `R$ ${whole}.${fraction}`;
}

export function formatMicro(raw: string, fractionDigits = 2): string {
  const { whole, fraction } = splitUnits(raw, 6);
  return fractionDigits > 0 ? `${whole}.${fraction.slice(0, fractionDigits)}` : whole;
}

export function formatSats(raw: string): string {
  return `${groupThousands(BigInt(raw).toString())} sats`;
}

export function formatPrice(method: PaymentMethod, raw: string): string {
  switch (method) {
    case 'PIX':
      return formatBrlCents(raw);
    case 'USDT':
    case 'USDC':
      return `${formatMicro(raw)} ${method}`;
    case 'BTC':
      return formatSats(raw);
    default: {
      const exhaustive: never = method;
      return String(exhaustive);
    }
  }
}

export function formatInteger(raw: string | number): string {
  return groupThousands(BigInt(raw).toString());
}

/** Every property has a public number in the order it joined the map: #1 is the first one ever. */
export function homeNumber(plotIndex: number): string {
  return `#${groupThousands(String(plotIndex + 1))}`;
}

/** 9,999 · 26.1K · 1.2M — for tight columns; exact integers stay elsewhere. */
export function formatCompact(value: number): string {
  if (value < 10_000) {
    return groupThousands(String(Math.trunc(value)));
  }
  if (value < 1_000_000) {
    return `${(Math.trunc(value / 100) / 10).toString()}K`;
  }
  return `${(Math.trunc(value / 100_000) / 10).toString()}M`;
}

/** Sign-less on purpose: the arrow beside it carries the direction. */
export function formatPct(value: number): string {
  const abs = Math.abs(value);
  return `${abs >= 100 ? Math.round(abs) : abs.toFixed(1)}%`;
}

export function formatWindow(seconds: number): string {
  if (seconds < 120) {
    return `${seconds}s`;
  }
  if (seconds < 7_200) {
    return `${Math.round(seconds / 60)} min`;
  }
  return `${Math.round(seconds / 3_600)}h`;
}

export const CLASS_LABELS: Readonly<Record<PropertyClass, string>> = {
  COTTAGE: 'Cottage',
  HOUSE: 'House',
  TOWNHOUSE: 'Townhouse',
  VILLA: 'Villa',
  TOWER: 'Tower',
  SKYSCRAPER: 'Skyscraper',
  MEGATOWER: 'Megatower',
  LANDMARK: 'Landmark',
};

export const RARITY_LABELS: Readonly<Record<ArchitectureRarity, string>> = {
  COMMON: 'Common',
  UNCOMMON: 'Uncommon',
  RARE: 'Rare',
  EPIC: 'Epic',
  LEGENDARY: 'Legendary',
  MYTHIC: 'Mythic',
  APEX: 'Apex',
};

/** Deed line: "Legendary · Round tower". */
export function architectureLabel(plotIndex: number, fans: number, footprint: PropertyFootprint): string {
  const look = architectureOf(plotIndex, fans, footprint);
  return `${RARITY_LABELS[look.rarity]} · ${look.style.name}`;
}

export const CATEGORY_LABELS: Readonly<Record<FandomCategory, string>> = {
  ARTIST: 'Artist',
  CLUB: 'Club',
  INFLUENCER: 'Creator',
  ATHLETE: 'Athlete',
  UNLISTED: 'Community',
};

export function timeAgo(iso: string, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.round(minutes / 60)}h`;
}
