import QRCode from 'qrcode';
import React, { useEffect, useMemo, useState } from 'react';
import type { PaymentMethod } from '../../core/types.js';
import type { CheckoutResponseDto, ListingDto, PublicConfigDto } from '../../shared/apiContract.js';
import { api, ApiError } from '../api/client.js';
import { formatMicro, formatPrice } from '../format.js';

const METHODS: readonly PaymentMethod[] = ['PIX', 'USDT', 'USDC', 'BTC'];

function priceOf(listing: ListingDto, method: PaymentMethod): string {
  return method === 'PIX' ? listing.priceBrlCents : method === 'BTC' ? listing.priceBtcSats : listing.priceUsdtMicro;
}

function listingTitle(listing: ListingDto): string {
  switch (listing.assetType) {
    case 'LAND_PLOT':
      return `Land #${listing.plotIndex}`;
    case 'NEFA_PACK':
      return `${formatMicro(listing.tokenAmountMicro ?? '0', 0)} $NEFA pack`;
    case 'FOUNDER_BADGE':
      return `🎖️ Tag de capitão de @${listing.badgeIdol ?? '?'}`;
    default: {
      const exhaustive: never = listing.assetType;
      return String(exhaustive);
    }
  }
}

export interface MarketplaceModalProps {
  readonly listings: readonly ListingDto[];
  readonly config: PublicConfigDto;
  /** The connected profile buys; null asks to connect first. */
  readonly buyerHandle: string | null;
  /** Opened from a property's "Buy now": show that listing first. */
  readonly focusListingId?: string | null;
  readonly onConnect: () => void;
  readonly onClose: () => void;
}

interface ActiveCheckout {
  readonly response: CheckoutResponseDto;
  readonly buyerHandle: string;
  readonly qrDataUrl: string | null;
}

export const MarketplaceModal: React.FC<MarketplaceModalProps> = ({ listings, config, buyerHandle, focusListingId = null, onConnect, onClose }) => {
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<ActiveCheckout | null>(null);
  const [copied, setCopied] = useState(false);

  // While a payment is pending, only the explicit buttons may leave the
  // checkout: a stray backdrop click or Escape would lose the QR code.
  const dismissible = checkout === null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismissible && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, dismissible]);

  const visible = useMemo(
    () =>
      [...listings]
        .filter((l) => l.status !== 'CANCELLED')
        .sort(
          (a, b) =>
            Number(b.listingId === focusListingId) - Number(a.listingId === focusListingId) ||
            Number(a.status === 'SETTLED') - Number(b.status === 'SETTLED')
        ),
    [listings, focusListingId]
  );
  const settledForUs = checkout
    ? listings.find(
        (l) => l.listingId === checkout.response.listingId && l.status === 'SETTLED' && l.buyerHandle === checkout.buyerHandle
      )
    : undefined;

  const buy = async (listing: ListingDto): Promise<void> => {
    setError(null);
    if (!buyerHandle) {
      onConnect();
      return;
    }
    setBusyId(listing.listingId);
    try {
      const response = await api.checkout(listing.listingId, method);
      const qrDataUrl = response.pix
        ? await QRCode.toDataURL(response.pix.copiaECola, { margin: 1, width: 232, errorCorrectionLevel: 'M' })
        : null;
      setCheckout({ response, buyerHandle, qrDataUrl });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the payment.');
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError('Copy failed; select the code manually.');
    }
  };

  const simulate = async (): Promise<void> => {
    if (!checkout) {
      return;
    }
    try {
      await api.simulatePayment(checkout.response.listingId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not simulate the payment.');
    }
  };

  return (
    <div className="modal-backdrop" onClick={dismissible ? onClose : undefined}>
      <section
        className="glass modal"
        role="dialog"
        aria-modal="true"
        aria-label="Mercado Não É Um Fã"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <span className="eyebrow">Mercado P2P · escrow</span>
            <h2 className="title-md">Terrenos &amp; $NEFA</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>

        {checkout === null && (
          <>
            <div className="segmented" role="radiogroup" aria-label="Forma de pagamento">
              {METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  disabled={!config.paymentRails[m]}
                  className="segmented__item"
                  onClick={() => setMethod(m)}
                  title={config.paymentRails[m] ? undefined : 'Not configured on this server yet'}
                >
                  {m}
                </button>
              ))}
            </div>
            {buyerHandle ? (
              <p className="caption">
                Buying as <strong>@{buyerHandle}</strong> · verified on Instagram
              </p>
            ) : (
              <button type="button" className="button button--secondary" onClick={onConnect}>
                Conecta teu Instagram pra comprar
              </button>
            )}
            {error && <p className="notice notice--danger">{error}</p>}
            <ul className="listings">
              {visible.length === 0 && <li className="caption">Nothing for sale yet.</li>}
              {visible.map((listing) => (
                <li key={listing.listingId} className="listing">
                  <div>
                    <strong>{listingTitle(listing)}</strong>
                    <span className="caption">
                      {listing.status === 'SETTLED'
                        ? `Sold to @${listing.buyerHandle}`
                        : `${formatPrice(method, priceOf(listing, method))} · seller @${listing.sellerHandle}`}
                    </span>
                  </div>
                  {listing.status === 'SETTLED' ? (
                    <span className="badge badge--muted">Sold</span>
                  ) : listing.sellerHandle === buyerHandle ? (
                    <span className="badge badge--accent">Yours</span>
                  ) : (
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={busyId !== null || !config.paymentRails[method]}
                      onClick={() => void buy(listing)}
                    >
                      {busyId === listing.listingId ? 'Reserving…' : listing.status === 'LOCKED_ESCROW' ? 'Being paid' : 'Buy'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {checkout !== null && settledForUs === undefined && (
          <div className="checkout">
            <p className="caption">
              Reserved for @{checkout.buyerHandle} until{' '}
              {new Date(checkout.response.expiresAtIso).toLocaleTimeString('en-US')}.
            </p>
            <p className="title-sm">{formatPrice(checkout.response.paymentMethod, checkout.response.amountInteger)}</p>
            {checkout.response.pix && (
              <>
                {checkout.response.pix.demoKey && (
                  <p className="notice notice--warning">Demo PIX key. Do not pay this code.</p>
                )}
                {checkout.qrDataUrl && <img className="checkout__qr" src={checkout.qrDataUrl} alt="PIX QR code" />}
                <textarea className="field__input checkout__code" readOnly value={checkout.response.pix.copiaECola} rows={2} />
                <button type="button" className="button button--secondary" onClick={() => void copy(checkout.response.pix?.copiaECola ?? '')}>
                  {copied ? 'Copied' : 'Copy PIX code'}
                </button>
              </>
            )}
            {checkout.response.crypto && (
              <dl className="facts">
                <div>
                  <dt>Network</dt>
                  <dd>{checkout.response.crypto.network}</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd className="mono">{checkout.response.crypto.address}</dd>
                </div>
                <div>
                  <dt>Memo</dt>
                  <dd className="mono">{checkout.response.crypto.memo}</dd>
                </div>
              </dl>
            )}
            <p className="caption checkout__waiting">Waiting for payment confirmation…</p>
            {config.demo && (
              <button type="button" className="button button--primary" onClick={() => void simulate()}>
                Simulate payment (demo)
              </button>
            )}
            {error && <p className="notice notice--danger">{error}</p>}
            <button type="button" className="button button--ghost" onClick={() => setCheckout(null)}>
              Back
            </button>
          </div>
        )}

        {settledForUs !== undefined && (
          <div className="checkout checkout--done">
            <span className="badge badge--success">Payment confirmed</span>
            <p className="title-sm">
              {listingTitle(settledForUs)} now belongs to @{settledForUs.buyerHandle}
            </p>
            <button type="button" className="button button--primary" onClick={() => setCheckout(null)}>
              Continue
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
