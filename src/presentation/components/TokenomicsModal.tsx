/** $FANT explained with live numbers (A11): supply, buckets, the halving mint and reputation seasons. */

import React from 'react';
import type { AllocationBucket } from '../../core/tokenomics.js';
import type { TokenomicsDto } from '../../shared/apiContract.js';
import { formatInteger, formatMicro } from '../format.js';

const BUCKET_COPY: Readonly<Record<AllocationBucket, { readonly label: string; readonly how: string; readonly color: string }>> = {
  FAN_MINT: { label: 'Fan Mint', how: 'A pack for every new member; halves each era', color: '#3AD6FF' },
  SEASONS: { label: 'Seasons', how: 'Paid by reputation (XP) earned each season', color: '#BF5AF2' },
  LIQUIDITY: { label: 'Liquidity', how: 'Locked for marketplace liquidity', color: '#30D158' },
  TREASURY: { label: 'Treasury', how: 'Locked · 48-month vesting, 12-month cliff', color: '#FF9F0A' },
  ECOSYSTEM: { label: 'Ecosystem', how: 'Locked · partner and creator grants', color: '#FFD60A' },
};

function pct(part: string, whole: string): number {
  const w = BigInt(whole);
  return w === 0n ? 0 : Number((BigInt(part) * 10_000n) / w) / 100;
}

export const TokenomicsModal: React.FC<{ readonly tokenomics: TokenomicsDto; readonly onClose: () => void }> = ({ tokenomics, onClose }) => {
  const { fanMint, seasons } = tokenomics;
  const idolShare = (BigInt(fanMint.packMicro) * BigInt(fanMint.idolRoyaltyBps)) / BigInt(10_000 - fanMint.idolRoyaltyBps);
  let offset = 0;
  const donut = tokenomics.buckets
    .map((b) => {
      const from = offset;
      offset += b.bps / 100;
      return `${BUCKET_COPY[b.bucket].color} ${from}% ${offset}%`;
    })
    .join(', ');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="glass modal modal--tokenomics" role="dialog" aria-modal="true" aria-label="$FANT tokenomics" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <div>
            <span className="eyebrow">Tokenomics · live</span>
            <h2 className="title-md">$FANT</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="supply">
          <div className="supply__numbers">
            <strong>{formatMicro(tokenomics.mintedMicro, 0)}</strong>
            <span className="caption">of {formatMicro(tokenomics.maxSupplyMicro, 0)} $FANT ever ({pct(tokenomics.mintedMicro, tokenomics.maxSupplyMicro)}%)</span>
          </div>
          <span className="xp-bar" aria-hidden="true">
            <span className="xp-bar__fill" style={{ width: `${Math.max(0.5, pct(tokenomics.mintedMicro, tokenomics.maxSupplyMicro))}%` }} />
          </span>
        </div>

        <div className="allocation">
          <div className="allocation__donut" style={{ background: `conic-gradient(${donut})` }} aria-hidden="true" />
          <ul className="allocation__list">
            {tokenomics.buckets.map((b) => (
              <li key={b.bucket}>
                <span className="league__dot" style={{ backgroundColor: BUCKET_COPY[b.bucket].color }} aria-hidden="true" />
                <span>
                  <strong>
                    {b.bps / 100}% {BUCKET_COPY[b.bucket].label}
                  </strong>
                  <span className="caption">
                    {BUCKET_COPY[b.bucket].how}
                    {!b.locked && ` · ${formatMicro(b.emittedMicro, 0)} / ${formatMicro(b.capMicro, 0)} emitted`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <dl className="stats-grid">
          <div>
            <dt>Next newcomer gets</dt>
            <dd>{formatMicro(fanMint.packMicro, 0)}</dd>
          </div>
          <div>
            <dt>Their idol gets</dt>
            <dd>{formatMicro(idolShare.toString(), 0)}</dd>
          </div>
          <div>
            <dt>Mint era</dt>
            <dd>#{fanMint.era}</dd>
          </div>
          <div>
            <dt>Members</dt>
            <dd>{formatInteger(fanMint.members)}</dd>
          </div>
          <div>
            <dt>Next halving at</dt>
            <dd>{fanMint.nextEraAtMember === null ? '—' : `#${formatInteger(fanMint.nextEraAtMember)}`}</dd>
          </div>
          <div>
            <dt>Next season prize</dt>
            <dd>{formatMicro(seasons.nextPrizeMicro, 0)}</dd>
          </div>
        </dl>

        {seasons.last && (
          <section className="profile__section" aria-label="Last season">
            <h3 className="title-sm">Season {seasons.last.season} paid {formatMicro(seasons.last.paidMicro, 0)} $FANT</h3>
            <ol className="season-top">
              {seasons.last.top.slice(0, 5).map((w) => (
                <li key={w.handle}>
                  <strong>@{w.handle}</strong>
                  <span className="caption">{formatMicro(w.micro, 2)} $FANT</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="profile__section" aria-label="Rules">
          <h3 className="title-sm">The rules of the game</h3>
          <ul className="rules">
            <li>One pack per Instagram account, ever — and packs halve as the planet grows, so early fans win and fake accounts stop paying off.</li>
            <li>10% of every pack goes to the idol who was named: anyone can be an idol, so bring real fans.</li>
            <li>Seasons pay $FANT in proportion to the XP earned in them. XP is capped per post and per day, can never be bought or sold, and no one takes more than 2% of a season.</li>
            <li>Tag friends after you join: +1 XP per new friend, once each, up to 20 a day.</li>
            <li>The supply can never pass 100,000,000. Locked buckets are never emitted by the game.</li>
          </ul>
        </section>
      </section>
    </div>
  );
};
