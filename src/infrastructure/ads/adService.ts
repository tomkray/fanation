/**
 * Ad inventory: partner requests waiting for review, approved campaigns, and
 * Não É Um Fã's own "advertise here" creatives that fill unsold slots. Stored as
 * one JSON file written atomically (write + rename), so a crash never leaves
 * half a file. No money moves here yet: a request carries a quote; payment is
 * taken after review through the regular payment rails.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AD_MAX_DAYS, AD_PLACEMENTS, AD_RATE_CARD_CENTS_PER_DAY, AdCampaign, AdRequest, isAdLive, quoteAd } from '../../core/ads.js';
import { AdDto, AdRequestReceiptDto, AdsDto } from '../../shared/apiContract.js';
import { logger } from '../../utils/logger.js';

/** Unreviewed requests are capped so the endpoint cannot be used to fill the disk. */
const MAX_PENDING_REQUESTS = 300;
const DEMO_PREFIX = 'demo_';

type StoredCampaign = Omit<AdCampaign, 'quoteBrlCents'> & { readonly quoteBrlCents: string };

export class AdQueueFullError extends Error {
  constructor() {
    super('Too many ad requests are waiting for review; try again later.');
    this.name = 'AdQueueFullError';
  }
}

export class AdNotFoundError extends Error {
  constructor(id: string) {
    super(`No ad campaign ${id}.`);
    this.name = 'AdNotFoundError';
  }
}

function houseCampaign(id: string, request: AdRequest, createdAtIso: string): AdCampaign {
  return { ...request, id, status: 'APPROVED', quoteBrlCents: 0n, createdAtIso, startsAtIso: createdAtIso, house: true };
}

/** What flies when a slot is unsold: it sells the slot itself. */
function houseInventory(nowIso: string, demo: boolean): AdCampaign[] {
  const contactEmail = 'ads@naoeumfa.com';
  const house: AdCampaign[] = [
    houseCampaign('house_zeppelin', {
      placement: 'ZEPPELIN', city: 'ALL', days: 1, contactEmail,
      creative: { headline: 'Sua marca aqui', tagline: 'Zepelim em toda cidade · toca pra reservar', partnerHandle: 'naoeumfa', backgroundHex: '#0A1128', accentHex: '#3AD6FF' },
    }, nowIso),
    houseCampaign('house_billboard', {
      placement: 'BILLBOARD', city: 'ALL', days: 1, contactEmail,
      creative: { headline: 'Anuncie no Não É Um Fã', tagline: 'Outdoor dentro das cidades', partnerHandle: 'naoeumfa', backgroundHex: '#1A0B2E', accentHex: '#BF5AF2' },
    }, nowIso),
    houseCampaign('house_banner', {
      placement: 'SKY_BANNER', city: 'ALL', days: 1, contactEmail,
      creative: { headline: 'Voa tua faixa', tagline: 'Todo mundo no céu vai ver', partnerHandle: 'naoeumfa', backgroundHex: '#2B1600', accentHex: '#FFD60A' },
    }, nowIso),
  ];
  if (demo) {
    // Fictional partners with `.demo` handles: they fly exactly like approved partners without impersonating anyone.
    const partner = (id: string, request: AdRequest): AdCampaign => ({ ...houseCampaign(id, request, nowIso), house: false, days: AD_MAX_DAYS });
    house.push(
      partner(`${DEMO_PREFIX}neoncola`, {
        placement: 'ZEPPELIN', city: 'GENESIS', days: AD_MAX_DAYS, contactEmail,
        creative: { headline: 'NEON COLA', tagline: 'The official drink of fandoms', partnerHandle: 'neoncola.demo', backgroundHex: '#3A0010', accentHex: '#FF375F' },
      }),
      partner(`${DEMO_PREFIX}pulse`, {
        placement: 'ZEPPELIN', city: 'GENESIS', days: AD_MAX_DAYS, contactEmail,
        creative: { headline: 'PULSE Headphones', tagline: 'Hear the stadium roar', partnerHandle: 'pulseaudio.demo', backgroundHex: '#002A1A', accentHex: '#30D158' },
      }),
      partner(`${DEMO_PREFIX}starfuel`, {
        placement: 'BILLBOARD', city: 'GENESIS', days: AD_MAX_DAYS, contactEmail,
        creative: { headline: 'STARFUEL Energy', tagline: 'Create all night', partnerHandle: 'starfuel.demo', backgroundHex: '#2A1800', accentHex: '#FF9F0A' },
      }),
    );
  }
  return house;
}

/** Built-in inventory (house + demo partners) is code, rebuilt on boot, never written to the ads file. */
function isBuiltIn(campaign: { readonly id: string; readonly house: boolean }): boolean {
  return campaign.house || campaign.id.startsWith(DEMO_PREFIX);
}

function toDto(campaign: AdCampaign): AdDto {
  const { creative } = campaign;
  return {
    id: campaign.id,
    placement: campaign.placement,
    city: campaign.city,
    headline: creative.headline,
    tagline: creative.tagline,
    partnerHandle: creative.partnerHandle,
    backgroundHex: creative.backgroundHex,
    accentHex: creative.accentHex,
    house: campaign.house,
  };
}

export class AdService {
  private readonly campaigns = new Map<string, AdCampaign>();

  constructor(
    private readonly filePath: string,
    private readonly demo: boolean,
    private readonly now: () => number = Date.now
  ) {
    this.load();
  }

  /** Live partner campaigns first; house creatives fill the rest. */
  publicAds(): AdsDto {
    const nowMs = this.now();
    const live = [...this.campaigns.values()].filter((c) => isAdLive(c, nowMs)).sort((a, b) => Number(a.house) - Number(b.house) || a.createdAtIso.localeCompare(b.createdAtIso));
    return {
      rateCard: AD_PLACEMENTS.map((placement) => ({ placement, centsPerDay: AD_RATE_CARD_CENTS_PER_DAY[placement].toString() })),
      campaigns: live.map(toDto),
    };
  }

  request(request: AdRequest): AdRequestReceiptDto {
    const pending = [...this.campaigns.values()].filter((c) => c.status === 'PENDING_REVIEW').length;
    if (pending >= MAX_PENDING_REQUESTS) {
      throw new AdQueueFullError();
    }
    const campaign: AdCampaign = {
      ...request,
      id: `ad_${randomBytes(8).toString('hex')}`,
      status: 'PENDING_REVIEW',
      quoteBrlCents: quoteAd(request.placement, request.days),
      createdAtIso: new Date(this.now()).toISOString(),
      startsAtIso: null,
      house: false,
    };
    this.campaigns.set(campaign.id, campaign);
    this.save();
    logger.info('ad_requested', { id: campaign.id, placement: campaign.placement, days: campaign.days });
    return { id: campaign.id, status: campaign.status, placement: campaign.placement, days: campaign.days, quoteBrlCents: campaign.quoteBrlCents.toString() };
  }

  /** Admin view: everything, including the contact e-mail. */
  all(): StoredCampaign[] {
    return [...this.campaigns.values()].map((c) => ({ ...c, quoteBrlCents: c.quoteBrlCents.toString() }));
  }

  review(id: string, decision: 'APPROVED' | 'REJECTED'): StoredCampaign {
    const campaign = this.campaigns.get(id);
    if (!campaign || isBuiltIn(campaign)) {
      throw new AdNotFoundError(id);
    }
    const next: AdCampaign = {
      ...campaign,
      status: decision,
      startsAtIso: decision === 'APPROVED' ? new Date(this.now()).toISOString() : null,
    };
    this.campaigns.set(id, next);
    this.save();
    logger.info('ad_reviewed', { id, decision });
    return { ...next, quoteBrlCents: next.quoteBrlCents.toString() };
  }

  private load(): void {
    if (existsSync(this.filePath)) {
      try {
        const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf-8'));
        const stored = typeof raw === 'object' && raw !== null && Array.isArray((raw as { campaigns?: unknown }).campaigns) ? (raw as { campaigns: StoredCampaign[] }).campaigns : [];
        for (const c of stored) {
          if (!isBuiltIn(c)) {
            this.campaigns.set(c.id, { ...c, quoteBrlCents: BigInt(c.quoteBrlCents) });
          }
        }
      } catch (err) {
        // Ads must never take the world down: keep the bad file for inspection and fly house ads.
        const aside = `${this.filePath}.corrupt-${this.now()}`;
        renameSync(this.filePath, aside);
        logger.error('ads_file_unreadable', { moved_to: aside, message: err instanceof Error ? err.message : String(err) });
      }
    }
    // House inventory is code, not data: it is rebuilt on every boot and never persisted.
    for (const c of houseInventory(new Date(this.now()).toISOString(), this.demo)) {
      this.campaigns.set(c.id, c);
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const body = JSON.stringify({ campaigns: this.all().filter((c) => !isBuiltIn(c)) }, null, 2);
    writeFileSync(`${this.filePath}.tmp`, body, { mode: 0o600 });
    renameSync(`${this.filePath}.tmp`, this.filePath);
  }
}
