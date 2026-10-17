/**
 * The profile wallet: everything a verified @ owns and controls, and every
 * stat they earned on Instagram, turned into a game profile.
 */

import React, { useState } from 'react';
import type { MeDto, OfferDto } from '../../shared/apiContract.js';
import { api, ApiError, centsFromInput, microFromInput } from '../api/client.js';
import { CLASS_LABELS, formatBrlCents, formatInteger, formatMicro, homeNumber } from '../format.js';
import { Avatar } from './Identity.js';

export interface ProfileModalProps {
  readonly me: MeDto;
  readonly onChanged: () => void;
  readonly onShowProperty: (plotIndex: number) => void;
  readonly onBuyListing: (listingId: string) => void;
  readonly onLogout: () => void;
  readonly onClose: () => void;
}

function OfferRow({ offer, mine, busy, act }: { readonly offer: OfferDto; readonly mine: boolean; readonly busy: boolean; readonly act: (action: 'accept' | 'decline' | 'withdraw') => void }): React.ReactElement {
  const who = mine ? `to @${offer.toHandle}` : `from @${offer.fromHandle}`;
  return (
    <li className="listing">
      <div>
        <strong>{formatBrlCents(offer.amountBrlCents)}</strong>
        <span className="caption">
          Home {homeNumber(offer.plotIndex)} · {who} · {offer.status.toLowerCase()}
        </span>
      </div>
      {offer.status === 'PENDING' && !mine && (
        <span className="listing__actions">
          <button type="button" className="button button--primary" disabled={busy} onClick={() => act('accept')}>
            Accept
          </button>
          <button type="button" className="button button--ghost" disabled={busy} onClick={() => act('decline')}>
            Decline
          </button>
        </span>
      )}
      {offer.status === 'PENDING' && mine && (
        <button type="button" className="button button--ghost" disabled={busy} onClick={() => act('withdraw')}>
          Withdraw
        </button>
      )}
    </li>
  );
}

export const ProfileModal: React.FC<ProfileModalProps> = ({ me, onChanged, onShowProperty, onBuyListing, onLogout, onClose }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [badgeTo, setBadgeTo] = useState<Record<string, string>>({});
  const [badgePrice, setBadgePrice] = useState<Record<string, string>>({});

  const run = async (label: string, action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(label);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const listedPlots = new Map(me.listings.filter((l) => l.plotIndex !== null).map((l) => [l.plotIndex as number, l]));
  const acceptedForMe = me.offersMade.filter((o) => o.status === 'ACCEPTED' && o.listingId);

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <section className="glass modal modal--profile" role="dialog" aria-modal="true" aria-label={`@${me.handle} profile`} onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <div className="profile__identity">
            <Avatar handle={me.handle} size="lg" />
            <div>
              <h2 className="title-md">@{me.handle}</h2>
              <span className="badge badge--success">Verified on Instagram</span>
            </div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar" disabled={busy}>
            ×
          </button>
        </header>

        <div className="profile__level">
          <span className="level-badge">Lv {me.level}</span>
          <span className="xp-bar" aria-hidden="true">
            <span className="xp-bar__fill" style={{ width: `${Math.round(me.levelProgress * 100)}%` }} />
          </span>
          <strong>{formatInteger(me.reputationXp)} XP</strong>
        </div>

        <dl className="stats-grid">
          <div>
            <dt>$NEFA</dt>
            <dd>{formatMicro(me.tokenBalanceMicro)}</dd>
          </div>
          <div>
            <dt>Fans</dt>
            <dd>{formatInteger(me.fans)}</dd>
          </div>
          <div>
            <dt>Idol rank</dt>
            <dd>{me.idolRank ? `#${me.idolRank}` : '—'}</dd>
          </div>
          <div>
            <dt>Idols supported</dt>
            <dd>{formatInteger(me.idolsSupported)}</dd>
          </div>
          <div>
            <dt>Comments counted</dt>
            <dd>{formatInteger(me.countedComments)}</dd>
          </div>
          <div>
            <dt>Bank</dt>
            <dd>{formatInteger(me.homesOwned)} home{me.homesOwned === 1 ? '' : 's'}</dd>
          </div>
        </dl>

        {error && <p className="notice notice--danger">{error}</p>}
        {notice && <p className="notice notice--success">{notice}</p>}

        <section className="profile__section" aria-label="Seu banco">
          <h3 className="title-sm">Seu banco</h3>
          <p className="caption">
            {me.mintedPlotIndex !== null
              ? `One mint (${homeNumber(me.mintedPlotIndex)}). The rest you buy.`
              : 'Comenta o @ do ídolo no @naoeumfa pra mintar a primeira casa. Depois disso, só comprando.'}
          </p>
          {me.properties.length === 0 && <p className="caption">No deeds in the bank yet.</p>}
          <ul className="listings">
            {me.properties.map((p) => {
              const listing = listedPlots.get(p.plotIndex);
              return (
                <li key={p.plotIndex} className="listing listing--property">
                  <div>
                    <strong>
                      {CLASS_LABELS[p.propertyClass]} {homeNumber(p.plotIndex)}
                    </strong>
                    <span className="caption">
                      {formatInteger(p.fans)} fans · next to @{p.idolHandle ?? p.minterHandle}
                      {listing ? ` · listed at ${formatBrlCents(listing.priceBrlCents)}` : ''}
                    </span>
                  </div>
                  <span className="listing__actions">
                    <button type="button" className="button button--ghost" onClick={() => onShowProperty(p.plotIndex)}>
                      Show
                    </button>
                    {listing ? (
                      <button type="button" className="button button--secondary" disabled={busy || listing.status !== 'OPEN'} onClick={() => void run('Listing cancelled.', () => api.cancelListing(listing.listingId))}>
                        {listing.status === 'OPEN' ? 'Cancelar anúncio' : 'Pagamento em curso'}
                      </button>
                    ) : (
                      <span className="inline-form">
                        <input
                          className="field__input field__input--compact"
                          inputMode="decimal"
                          placeholder="R$ price"
                          aria-label={`Price for home ${p.plotIndex}`}
                          value={prices[p.plotIndex] ?? ''}
                          onChange={(e) => setPrices({ ...prices, [p.plotIndex]: e.target.value })}
                        />
                        <button
                          type="button"
                          className="button button--primary"
                          disabled={busy || !centsFromInput(prices[p.plotIndex] ?? '')}
                          onClick={() => {
                            const cents = centsFromInput(prices[p.plotIndex] ?? '');
                            if (cents) {
                              void run('Colocado à venda.', () => api.listProperty(p.plotIndex, cents));
                            }
                          }}
                        >
                          List now
                        </button>
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {acceptedForMe.length > 0 && (
          <section className="profile__section" aria-label="Accepted offers">
            <h3 className="title-sm">Sua oferta foi aceita 🎉</h3>
            <ul className="listings">
              {acceptedForMe.map((o) => (
                <li key={o.id} className="listing">
                  <div>
                    <strong>{formatBrlCents(o.amountBrlCents)}</strong>
                    <span className="caption">Home {homeNumber(o.plotIndex)} from @{o.toHandle} — first to pay gets it</span>
                  </div>
                  <button type="button" className="button button--primary" onClick={() => o.listingId && onBuyListing(o.listingId)}>
                    Comprar agora
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="profile__section" aria-label="Offers">
          <h3 className="title-sm">Ofertas</h3>
          {me.offersReceived.length === 0 && me.offersMade.length === 0 && <p className="caption">No offers yet.</p>}
          <ul className="listings">
            {me.offersReceived.map((o) => (
              <OfferRow key={o.id} offer={o} mine={false} busy={busy} act={(action) => void run(`Oferta ${action === 'accept' ? 'aceita — sua casa está anunciada nesse preço' : 'recusada'}.`, () => api.decideOffer(o.id, action))} />
            ))}
            {me.offersMade.map((o) => (
              <OfferRow key={o.id} offer={o} mine busy={busy} act={(action) => void run('Oferta retirada.', () => api.decideOffer(o.id, action))} />
            ))}
          </ul>
        </section>

        {me.badges.length > 0 && (
          <section className="profile__section" aria-label="Tags de capitão">
            <h3 className="title-sm">🎖️ Tuas tags de capitão</h3>
            <p className="caption">Você trouxe esse ídolo pra cidade, ou comprou a tag de quem trouxe. Dá pra dar de presente ou vender.</p>
            <ul className="listings">
              {me.badges.map((b) => (
                <li key={b.idolHandle} className="listing listing--property">
                  <div>
                    <strong>Capitão de @{b.idolHandle}</strong>
                    <span className="caption">
                      {b.founderHandle === me.handle ? 'Você fundou' : `Fundado por @${b.founderHandle}`}
                      {b.listingId ? ' · à venda' : ''}
                    </span>
                  </div>
                  {b.listingId ? (
                    <button type="button" className="button button--secondary" disabled={busy} onClick={() => void run('Venda da tag cancelada.', () => api.cancelListing(b.listingId as string))}>
                      Cancelar venda
                    </button>
                  ) : (
                    <span className="listing__actions">
                      <span className="inline-form">
                        <input
                          className="field__input field__input--compact"
                          placeholder="@amigo"
                          aria-label={`Dar a tag de @${b.idolHandle} para`}
                          value={badgeTo[b.idolHandle] ?? ''}
                          onChange={(e) => setBadgeTo({ ...badgeTo, [b.idolHandle]: e.target.value })}
                          autoCapitalize="none"
                          spellCheck={false}
                          maxLength={31}
                        />
                        <button
                          type="button"
                          className="button button--ghost"
                          disabled={busy || !(badgeTo[b.idolHandle] ?? '').trim()}
                          onClick={() => void run(`Tag de @${b.idolHandle} enviada.`, () => api.transferBadge(b.idolHandle, badgeTo[b.idolHandle] ?? ''))}
                        >
                          Dar
                        </button>
                      </span>
                      <span className="inline-form">
                        <input
                          className="field__input field__input--compact"
                          inputMode="decimal"
                          placeholder="R$ preço"
                          aria-label={`Preço da tag de @${b.idolHandle}`}
                          value={badgePrice[b.idolHandle] ?? ''}
                          onChange={(e) => setBadgePrice({ ...badgePrice, [b.idolHandle]: e.target.value })}
                        />
                        <button
                          type="button"
                          className="button button--primary"
                          disabled={busy || !centsFromInput(badgePrice[b.idolHandle] ?? '')}
                          onClick={() => {
                            const cents = centsFromInput(badgePrice[b.idolHandle] ?? '');
                            if (cents) {
                              void run('Tag colocada à venda.', () => api.listBadge(b.idolHandle, cents));
                            }
                          }}
                        >
                          Vender
                        </button>
                      </span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="profile__section" aria-label="Enviar $NEFA">
          <h3 className="title-sm">Enviar $NEFA</h3>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const micro = microFromInput(sendAmount);
              if (micro) {
                void run(`Sent ${sendAmount} $NEFA to @${sendTo.replace(/^@/, '')}.`, () => api.transfer(sendTo, micro)).then(() => setSendAmount(''));
              }
            }}
          >
            <input className="field__input" placeholder="@friend" value={sendTo} onChange={(e) => setSendTo(e.target.value)} autoCapitalize="none" spellCheck={false} maxLength={31} required />
            <input className="field__input field__input--compact" inputMode="decimal" placeholder="Valor" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} required />
            <button type="submit" className="button button--primary" disabled={busy || !microFromInput(sendAmount)}>
              Send
            </button>
          </form>
          <p className="caption">XP se ganha e fica contigo pra sempre; só $NEFA, casas e tags de capitão mudam de mão.</p>
        </section>

        <footer className="profile__footer">
          <button type="button" className="button button--ghost" onClick={onLogout} disabled={busy}>
            Disconnect
          </button>
        </footer>
      </section>
    </div>
  );
};
