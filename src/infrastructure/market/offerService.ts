/**
 * Offers on someone's property: non-binding until the owner accepts. No money
 * moves here — accepting turns the offer into a regular listing at the offered
 * price (a ledger event), which the bidder then pays through the normal
 * checkout. Stored as one JSON file written atomically.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { OfferDto, OfferStatus } from '../../shared/apiContract.js';
import { logger } from '../../utils/logger.js';

const MAX_PENDING_PER_BIDDER = 20;
const MAX_PENDING_TOTAL = 5_000;
export const MIN_OFFER_BRL_CENTS = 100n;
export const MAX_OFFER_BRL_CENTS = 100_000_000_000n;

export class OfferError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'OfferError';
  }
}

interface Offer {
  readonly id: string;
  readonly plotIndex: number;
  readonly fromHandle: string;
  readonly toHandle: string;
  readonly amountBrlCents: bigint;
  status: OfferStatus;
  readonly createdAtIso: string;
  listingId: string | null;
}

function toDto(offer: Offer): OfferDto {
  return { ...offer, amountBrlCents: offer.amountBrlCents.toString() };
}

export class OfferService {
  private readonly offers = new Map<string, Offer>();

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now
  ) {
    this.load();
  }

  make(input: { readonly plotIndex: number; readonly fromHandle: string; readonly toHandle: string; readonly amountBrlCents: bigint }): OfferDto {
    if (input.fromHandle === input.toHandle) {
      throw new OfferError(400, 'This is already yours.');
    }
    if (input.amountBrlCents < MIN_OFFER_BRL_CENTS || input.amountBrlCents > MAX_OFFER_BRL_CENTS) {
      throw new OfferError(400, 'Offer must be between R$ 1.00 and R$ 1,000,000,000.00.');
    }
    const pending = [...this.offers.values()].filter((o) => o.status === 'PENDING');
    if (pending.length >= MAX_PENDING_TOTAL || pending.filter((o) => o.fromHandle === input.fromHandle).length >= MAX_PENDING_PER_BIDDER) {
      throw new OfferError(429, 'Too many open offers; withdraw some first.');
    }
    // One open offer per bidder per property: a new one replaces the old.
    for (const o of pending) {
      if (o.fromHandle === input.fromHandle && o.plotIndex === input.plotIndex) {
        o.status = 'WITHDRAWN';
      }
    }
    const offer: Offer = {
      id: `off_${randomBytes(8).toString('hex')}`,
      ...input,
      status: 'PENDING',
      createdAtIso: new Date(this.now()).toISOString(),
      listingId: null,
    };
    this.offers.set(offer.id, offer);
    this.save();
    return toDto(offer);
  }

  received(handle: string): OfferDto[] {
    return [...this.offers.values()].filter((o) => o.toHandle === handle).sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso)).slice(0, 50).map(toDto);
  }

  made(handle: string): OfferDto[] {
    return [...this.offers.values()].filter((o) => o.fromHandle === handle).sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso)).slice(0, 50).map(toDto);
  }

  pendingCount(plotIndex: number): number {
    return [...this.offers.values()].filter((o) => o.plotIndex === plotIndex && o.status === 'PENDING').length;
  }

  /** The owner decides; `accept` hands back the offer so the caller can list the property at its price. */
  decide(id: string, ownerHandle: string, decision: 'ACCEPTED' | 'DECLINED'): OfferDto {
    const offer = this.requirePending(id);
    if (offer.toHandle !== ownerHandle) {
      throw new OfferError(403, 'Only the owner can answer this offer.');
    }
    offer.status = decision;
    this.save();
    return toDto(offer);
  }

  attachListing(id: string, listingId: string): void {
    const offer = this.offers.get(id);
    if (offer) {
      offer.listingId = listingId;
      this.save();
    }
  }

  /** Puts an accepted offer back to pending when listing it failed, so nothing is lost. */
  reopen(id: string): void {
    const offer = this.offers.get(id);
    if (offer && offer.status === 'ACCEPTED' && offer.listingId === null) {
      offer.status = 'PENDING';
      this.save();
    }
  }

  withdraw(id: string, bidderHandle: string): OfferDto {
    const offer = this.requirePending(id);
    if (offer.fromHandle !== bidderHandle) {
      throw new OfferError(403, 'Only the bidder can withdraw this offer.');
    }
    offer.status = 'WITHDRAWN';
    this.save();
    return toDto(offer);
  }

  private requirePending(id: string): Offer {
    const offer = this.offers.get(id);
    if (!offer) {
      throw new OfferError(404, 'No such offer.');
    }
    if (offer.status !== 'PENDING') {
      throw new OfferError(409, `This offer is already ${offer.status.toLowerCase()}.`);
    }
    return offer;
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      const list = Array.isArray(raw) ? (raw as (Omit<Offer, 'amountBrlCents'> & { amountBrlCents: string })[]) : [];
      for (const o of list) {
        this.offers.set(o.id, { ...o, amountBrlCents: BigInt(o.amountBrlCents) });
      }
    } catch (err) {
      const aside = `${this.filePath}.corrupt-${this.now()}`;
      renameSync(this.filePath, aside);
      logger.error('offers_file_unreadable', { moved_to: aside, message: err instanceof Error ? err.message : String(err) });
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const body = JSON.stringify([...this.offers.values()].map(toDto));
    writeFileSync(`${this.filePath}.tmp`, body, { mode: 0o600 });
    renameSync(`${this.filePath}.tmp`, this.filePath);
  }
}
