/**
 * One property and the profile living in it: what it is (class by fans,
 * finish by level), who owns it (@handle), how close it is to the next class,
 * and the idol it was built next to.
 */

import React, { useEffect, useState } from 'react';
import type { CitySummaryDto, PropertyDetailDto } from '../../shared/apiContract.js';
import { api, ApiError, centsFromInput } from '../api/client.js';
import { BLOCK_PITCH_METERS } from '../../core/cityLayout.js';
import { architectureOf } from '../../core/architecture.js';
import { architectureLabel, CATEGORY_LABELS, CLASS_LABELS, formatBrlCents, formatInteger, formatMicro, homeNumber, RARITY_LABELS } from '../format.js';
import { FloatingWindow } from './FloatingWindow.js';
import { Avatar, HandleName } from './Identity.js';

export type PropertyRef = { readonly kind: 'plot'; readonly plotIndex: number } | { readonly kind: 'handle'; readonly handle: string };

export interface PropertyCardProps {
  readonly target: PropertyRef;
  /** Bumps on every world version so the card stays live. */
  readonly version: number;
  readonly cities: readonly CitySummaryDto[];
  /** The connected profile, or null. */
  readonly viewer: string | null;
  readonly onFocusHandle: (handle: string) => void;
  /** The property shown (for the map's selection highlight), or null while loading. */
  readonly onDetail: (detail: PropertyDetailDto | null) => void;
  readonly onBuy: (listingId: string) => void;
  readonly onConnect: () => void;
  readonly onChanged: () => void;
  readonly onClose: () => void;
  /** Rendered picture of the property's building (PNG data URL), or null. */
  readonly portrait: (detail: PropertyDetailDto) => Promise<string | null>;
}

/** The building itself, framed like a collectible card. */
const DeedArt: React.FC<{ readonly detail: PropertyDetailDto; readonly portrait: PropertyCardProps['portrait'] }> = ({ detail, portrait }) => {
  const [url, setUrl] = useState<string | null>(null);
  const look = `${detail.plotIndex}|${detail.propertyClass}|${detail.level}|${detail.colorHex}`;
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    portrait(detail)
      .then((next) => !cancelled && setUrl(next))
      .catch((err: unknown) => console.warn('[fanation] portrait failed', err));
    return () => {
      cancelled = true;
    };
    // `look` captures everything that changes the picture; `detail` itself changes every refresh.
  }, [look, portrait]);
  return (
    <figure className="deed__art" style={{ background: `radial-gradient(circle at 50% 35%, ${detail.colorHex}55, #0b1020 72%)`, borderColor: detail.colorHex }}>
      {url ? <img src={url} alt={`${architectureLabel(detail.plotIndex, detail.fans, detail.footprint)} ${homeNumber(detail.plotIndex)}`} /> : <span className="deed__art-loading" aria-hidden="true" />}
      <figcaption>
        <span>{architectureOf(detail.plotIndex, detail.fans, detail.footprint).style.name}</span>
        <strong>{homeNumber(detail.plotIndex)}</strong>
      </figcaption>
    </figure>
  );
};

/** Buy now / List now / Make offer, depending on who is looking and whether it is for sale. */
const MarketBox: React.FC<{ readonly detail: PropertyDetailDto; readonly viewer: string | null; readonly onBuy: (id: string) => void; readonly onConnect: () => void; readonly onChanged: () => void }> = ({
  detail,
  viewer,
  onBuy,
  onConnect,
  onChanged,
}) => {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ readonly ok: boolean; readonly text: string } | null>(null);
  const { listing, sales, pendingOffers } = detail.market;
  const mine = viewer !== null && detail.handle === viewer;
  const cents = centsFromInput(amount);

  const run = async (ok: string, action: () => Promise<unknown>): Promise<void> => {
    if (!viewer) {
      onConnect();
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ ok: true, text: ok });
      setAmount('');
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Algo deu errado.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="market-box">
      {listing && (
        <p className="market-box__price">
          <span className="caption">{listing.status === 'OPEN' ? 'À venda' : 'Pagamento em curso'}</span>
          <strong>{formatBrlCents(listing.priceBrlCents)}</strong>
        </p>
      )}
      {mine ? (
        listing ? (
          <button type="button" className="button button--secondary" disabled={busy || listing.status !== 'OPEN'} onClick={() => void run('Anúncio cancelado.', () => api.cancelListing(listing.listingId))}>
            Cancel listing
          </button>
        ) : (
          <span className="inline-form">
            <input className="field__input field__input--compact" inputMode="decimal" placeholder="Preço R$" aria-label="Preço" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <button type="button" className="button button--primary" disabled={busy || !cents} onClick={() => cents && void run('Colocado à venda.', () => api.listProperty(detail.plotIndex, cents))}>
              List now
            </button>
          </span>
        )
      ) : (
        <>
          {listing?.status === 'OPEN' && (
            <button type="button" className="button button--primary" onClick={() => (viewer ? onBuy(listing.listingId) : onConnect())}>
              Buy now
            </button>
          )}
          <span className="inline-form">
            <input className="field__input field__input--compact" inputMode="decimal" placeholder="Oferta R$" aria-label="Oferta" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <button type="button" className="button button--secondary" disabled={busy || (viewer !== null && !cents)} onClick={() => (cents || !viewer) && void run(`Oferta enviada pra @${detail.handle}.`, () => api.makeOffer(detail.plotIndex, cents ?? '0'))}>
              {viewer ? 'Fazer oferta' : 'Entre pra fazer oferta'}
            </button>
          </span>
        </>
      )}
      {pendingOffers > 0 && <span className="caption">{pendingOffers} open offer{pendingOffers === 1 ? '' : 's'}</span>}
      {message && <p className={`notice ${message.ok ? 'notice--success' : 'notice--danger'}`}>{message.text}</p>}
      <p className="caption">Mint once per @. Buy more homes on the market — that is the bank.</p>
      {sales.length > 0 && (
        <ul className="sales">
          {sales.slice(0, 3).map((s) => (
            <li key={s.settledAtIso} className="caption">
              Sold {formatBrlCents(s.priceBrlCents)} · @{s.sellerHandle} → @{s.buyerHandle} · {new Date(s.settledAtIso).toLocaleDateString('en-US')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const LotAdBox: React.FC<{ readonly detail: PropertyDetailDto; readonly viewer: string | null; readonly onConnect: () => void; readonly onChanged: () => void }> = ({ detail, viewer, onConnect, onChanged }) => {
  const mine = viewer !== null && detail.handle === viewer;
  const [headline, setHeadline] = useState(detail.lotAd?.headline ?? '');
  const [tagline, setTagline] = useState(detail.lotAd?.tagline ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async (clear: boolean): Promise<void> => {
    if (!viewer) {
      onConnect();
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (clear) {
        await api.clearLotAd(detail.plotIndex);
      } else {
        await api.setLotAd(detail.plotIndex, {
          headline,
          tagline,
          backgroundHex: detail.lotAd?.backgroundHex ?? detail.colorHex,
          accentHex: '#FFFFFF',
        });
      }
      onChanged();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Não deu pra salvar o outdoor.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lot-ad">
      {detail.lotAd ? (
        <p className="lot-ad__banner" style={{ background: detail.lotAd.backgroundHex, color: detail.lotAd.accentHex }}>
          <strong>{detail.lotAd.headline}</strong>
          <span>{detail.lotAd.tagline}</span>
          <span className="caption">@{detail.handle} · on this lot</span>
        </p>
      ) : (
        <p className="caption">No billboard on this lot yet.</p>
      )}
      {mine && (
        <span className="inline-form lot-ad__form">
          <input className="field__input field__input--compact" maxLength={28} placeholder="Manchete" aria-label="Manchete do lote" value={headline} onChange={(e) => setHeadline(e.target.value)} />
          <input className="field__input field__input--compact" maxLength={44} placeholder="Frase" aria-label="Frase do lote" value={tagline} onChange={(e) => setTagline(e.target.value)} />
          <button type="button" className="button button--secondary" disabled={busy || headline.trim().length === 0 || tagline.trim().length === 0} onClick={() => void save(false)}>
            Post on lot
          </button>
          {detail.lotAd && (
            <button type="button" className="button button--ghost" disabled={busy} onClick={() => void save(true)}>
              Clear
            </button>
          )}
        </span>
      )}
      {message && <p className="notice notice--danger">{message}</p>}
    </div>
  );
};

export const PropertyCard: React.FC<PropertyCardProps> = ({ target, version, cities, viewer, onFocusHandle, onDetail, onBuy, onConnect, onChanged, onClose, portrait }) => {
  const [detail, setDetail] = useState<PropertyDetailDto | null>(null);
  const [missing, setMissing] = useState(false);
  const targetKey = target.kind === 'plot' ? `plot:${target.plotIndex}` : `handle:${target.handle}`;

  useEffect(() => {
    onDetail(detail);
  }, [detail, onDetail]);

  useEffect(() => {
    let cancelled = false;
    const load = target.kind === 'plot' ? api.property(target.plotIndex) : api.profile(target.handle);
    load
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setMissing(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMissing(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // `targetKey` stands in for `target` (a new object every render); `version` refreshes the same target.
  }, [targetKey, version]);

  if (!detail) {
    return (
      <FloatingWindow label="Imóvel" accentHex="#3ad6ff" onClose={onClose} band={<span className="deed__kicker">Escritura</span>}>
        <p className="caption">{missing ? 'Ainda não tá na cidade. Comenta o @ do ídolo no @naoeumfa pra se mudar.' : 'Carregando…'}</p>
      </FloatingWindow>
    );
  }

  const city = cities.find((c) => c.id === detail.city);
  const look = architectureOf(detail.plotIndex, detail.fans, detail.footprint);
  const nextLook = detail.nextClassAtFans !== null ? architectureOf(detail.plotIndex, detail.nextClassAtFans, detail.footprint) : null;
  const isIdol = detail.fans > 0 || detail.idolHandle === null;
  const blockX = Math.round(detail.x / BLOCK_PITCH_METERS);
  const blockZ = Math.round(detail.z / BLOCK_PITCH_METERS);
  const ownerChanged = detail.handle !== detail.minterHandle;
  return (
    <FloatingWindow
      label={`Casa ${homeNumber(detail.plotIndex)}`}
      accentHex={detail.colorHex}
      onClose={onClose}
      band={
        <>
          <span className="deed__kicker">
            Escritura · {city?.name ?? detail.city}
            {detail.idolRank !== null && ` · #${detail.idolRank} global`}
          </span>
          <h2 className="deed__number">Casa {homeNumber(detail.plotIndex)}</h2>
          <span className="deed__class">
            {RARITY_LABELS[look.rarity]} · {look.style.name}
            {detail.category !== 'UNLISTED' ? ` · ${CATEGORY_LABELS[detail.category]}` : ''}
          </span>
        </>
      }
    >
      <DeedArt detail={detail} portrait={portrait} />

      <div className="deed__owner">
        <Avatar handle={detail.handle} name={ownerChanged ? undefined : detail.displayName ?? undefined} colorHex={detail.colorHex} size="lg" />
        <span>
          <span className="caption">Dono</span>
          <HandleName handle={detail.handle} name={ownerChanged ? null : detail.displayName} />
          {ownerChanged && <span className="caption">Fundado por @{detail.minterHandle}</span>}
          <span className="deed__bank">
            Banco · {formatInteger(detail.ownerHomes)} casa{detail.ownerHomes === 1 ? '' : 's'}
          </span>
        </span>
        <span className="level-badge" style={{ borderColor: detail.colorHex }}>
          Nv {detail.level}
        </span>
      </div>

      <p className="deed__location">
        <span aria-hidden="true">📍</span>
        <span>
          {city?.name ?? detail.city} ·{' '}
          {detail.idolHandle ? (
            <>
              do lado de{' '}
              <button type="button" className="link-button link-button--inline" onClick={() => detail.idolHandle && onFocusHandle(detail.idolHandle)}>
                @{detail.idolHandle}
              </button>
            </>
          ) : (
            `distrito de @${detail.minterHandle}`
          )}{' '}
          · quadra {blockX}, {blockZ}
        </span>
      </p>

      <dl className="deed__rows">
        <div>
          <dt>Fãs</dt>
          <dd>
            {formatInteger(detail.fans)}
            {nextLook && detail.nextClassAtFans !== null && (
              <span className="caption">
                {' '}
                · {formatInteger(detail.nextClassAtFans - detail.fans)} até {RARITY_LABELS[nextLook.rarity]} {CLASS_LABELS[nextLook.propertyClass].toLowerCase()}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Estilo</dt>
          <dd>
            {RARITY_LABELS[look.rarity]} · {look.style.name}
          </dd>
        </div>
        <div>
          <dt>Banco do dono</dt>
          <dd>
            {formatInteger(detail.ownerHomes)} casa{detail.ownerHomes === 1 ? '' : 's'}
          </dd>
        </div>
        <div>
          <dt>Reputação do dono</dt>
          <dd>{formatInteger(detail.ownerReputationXp)} XP</dd>
        </div>
        <div>
          <dt>Owner balance</dt>
          <dd>{formatMicro(detail.ownerTokenBalanceMicro, 0)} $NEFA</dd>
        </div>
        {detail.neighbourhoods.length > 0 && (
          <div>
            <dt>Neighbourhoods</dt>
            <dd>{detail.neighbourhoods.length + 1}</dd>
          </div>
        )}
        <div>
          <dt>Since</dt>
          <dd>{new Date(detail.mintedAtIso).toLocaleDateString('en-US')}</dd>
        </div>
      </dl>

      <LotAdBox key={detail.plotIndex} detail={detail} viewer={viewer} onConnect={onConnect} onChanged={onChanged} />
      <MarketBox detail={detail} viewer={viewer} onBuy={onBuy} onConnect={onConnect} onChanged={onChanged} />
      <p className="caption">
        {isIdol
          ? `Every fan who comments @${detail.minterHandle} moves in around this ${look.style.name.toLowerCase()}. The @ earns XP; the deed can be sold.`
          : `You mint one home per @. Buy more on the market — that is the bank.`}
      </p>
    </FloatingWindow>
  );
};
