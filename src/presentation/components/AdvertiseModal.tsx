/**
 * Partners book a zeppelin, a billboard or a towed sky banner. The preview is
 * drawn exactly like the in-game creative (text + colours), the quote is
 * integer cents, and every request is reviewed before it flies; payment
 * (PIX or crypto) is collected after approval.
 */

import React, { useMemo, useState } from 'react';
import { AD_HEADLINE_MAX, AD_MAX_DAYS, AD_TAGLINE_MAX, AdCity, AdPlacement } from '../../core/ads.js';
import type { AdDto, AdRequestReceiptDto, AdsDto, CitySummaryDto } from '../../shared/apiContract.js';
import { api } from '../api/client.js';
import { formatBrlCents } from '../format.js';

const PLACEMENT_COPY: Readonly<Record<AdPlacement, { readonly label: string; readonly where: string }>> = {
  ZEPPELIN: { label: 'Zeppelin', where: 'Circles a city with your ad on both sides' },
  SKY_BANNER: { label: 'Sky banner', where: 'A plane tows your banner over the districts' },
  BILLBOARD: { label: 'Billboard', where: 'Neon billboards inside each city' },
};

export interface AdvertiseModalProps {
  readonly ads: AdsDto | null;
  /** The ad the visitor tapped in the world, if any. */
  readonly tapped: AdDto | null;
  readonly cities: readonly CitySummaryDto[];
  readonly onClose: () => void;
}

export const AdvertiseModal: React.FC<AdvertiseModalProps> = ({ ads, tapped, cities, onClose }) => {
  const [placement, setPlacement] = useState<AdPlacement>(tapped?.placement ?? 'ZEPPELIN');
  const [city, setCity] = useState<AdCity>('ALL');
  const [days, setDays] = useState(7);
  const [headline, setHeadline] = useState('');
  const [tagline, setTagline] = useState('');
  const [partner, setPartner] = useState('');
  const [backgroundHex, setBackground] = useState('#0A1128');
  const [accentHex, setAccent] = useState('#3AD6FF');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<AdRequestReceiptDto | null>(null);

  const rate = ads?.rateCard.find((r) => r.placement === placement);
  const quote = useMemo(() => (rate ? (BigInt(rate.centsPerDay) * BigInt(days)).toString() : null), [rate, days]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setReceipt(
        await api.requestAd({
          placement,
          city,
          days,
          contactEmail: email,
          creative: { headline, tagline, partnerHandle: partner, backgroundHex, accentHex },
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <section className="glass modal modal--ads" role="dialog" aria-modal="true" aria-label="Advertise on Fanation" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <div>
            <span className="eyebrow">Partners · in-game ads</span>
            <h2 className="title-md">Advertise on Fanation</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close" disabled={busy}>
            ×
          </button>
        </header>

        {tapped && !tapped.house && (
          <p className="caption">
            You tapped an ad by <strong>@{tapped.partnerHandle}</strong>. Your brand can fly here too.
          </p>
        )}

        {receipt ? (
          <div className="checkout checkout--done">
            <span className="badge badge--success">Request received</span>
            <p className="title-sm">
              {PLACEMENT_COPY[receipt.placement].label} · {receipt.days} days · {formatBrlCents(receipt.quoteBrlCents)}
            </p>
            <p className="caption">
              Reference <span className="mono">{receipt.id}</span>. Our team reviews every creative within 24 h; once approved we send the PIX or crypto
              payment details and your ad takes off.
            </p>
            <button type="button" className="button button--primary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <form className="ads-form" onSubmit={(e) => void submit(e)}>
            <div className="rate-card" role="radiogroup" aria-label="Placement">
              {(ads?.rateCard ?? []).map((r) => (
                <button
                  key={r.placement}
                  type="button"
                  role="radio"
                  aria-checked={placement === r.placement}
                  className="rate-card__item"
                  onClick={() => setPlacement(r.placement)}
                >
                  <strong>{PLACEMENT_COPY[r.placement].label}</strong>
                  <span className="caption">{PLACEMENT_COPY[r.placement].where}</span>
                  <span className="rate-card__price">{formatBrlCents(r.centsPerDay)} / day</span>
                </button>
              ))}
            </div>

            <div className="ad-preview" style={{ backgroundColor: backgroundHex, borderColor: accentHex }} aria-label="Preview">
              <strong style={{ textShadow: `0 0 16px ${accentHex}` }}>{headline || 'Your headline'}</strong>
              <span>{tagline || 'Your tagline'}</span>
              <span style={{ color: accentHex }}>@{partner.replace(/^@/, '') || 'your_brand'} · Sponsored</span>
            </div>

            <div className="ads-form__grid">
              <label className="field">
                <span className="caption">Headline ({AD_HEADLINE_MAX} max)</span>
                <input className="field__input" value={headline} maxLength={AD_HEADLINE_MAX} required onChange={(e) => setHeadline(e.target.value)} />
              </label>
              <label className="field">
                <span className="caption">Tagline ({AD_TAGLINE_MAX} max)</span>
                <input className="field__input" value={tagline} maxLength={AD_TAGLINE_MAX} required onChange={(e) => setTagline(e.target.value)} />
              </label>
              <label className="field">
                <span className="caption">Brand Instagram @ (printed on the ad)</span>
                <input className="field__input" value={partner} placeholder="@your_brand" required autoCapitalize="none" onChange={(e) => setPartner(e.target.value)} />
              </label>
              <label className="field">
                <span className="caption">Contact e-mail (private)</span>
                <input className="field__input" type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="field">
                <span className="caption">City</span>
                <select className="field__input" value={city} onChange={(e) => setCity(e.target.value as AdCity)}>
                  <option value="ALL">Every city</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="caption">Days (1–{AD_MAX_DAYS})</span>
                <input
                  className="field__input"
                  type="number"
                  min={1}
                  max={AD_MAX_DAYS}
                  value={days}
                  onChange={(e) => setDays(Math.min(AD_MAX_DAYS, Math.max(1, Number.parseInt(e.target.value, 10) || 1)))}
                />
              </label>
              <label className="field field--color">
                <span className="caption">Background</span>
                <input type="color" value={backgroundHex} onChange={(e) => setBackground(e.target.value.toUpperCase())} />
              </label>
              <label className="field field--color">
                <span className="caption">Neon accent</span>
                <input type="color" value={accentHex} onChange={(e) => setAccent(e.target.value.toUpperCase())} />
              </label>
            </div>

            {error && <p className="notice notice--danger">{error}</p>}
            <footer className="ads-form__footer">
              <span className="title-sm">{quote ? formatBrlCents(quote) : '—'}</span>
              <button type="submit" className="button button--primary" disabled={busy || !quote}>
                {busy ? 'Sending…' : 'Request this placement'}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
};
