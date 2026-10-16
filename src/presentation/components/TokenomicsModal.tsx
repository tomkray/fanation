/** $NEFA explained with live numbers (A11): supply, buckets, the halving mint and reputation seasons. */

import React from 'react';
import type { AllocationBucket } from '../../core/tokenomics.js';
import type { TokenomicsDto } from '../../shared/apiContract.js';
import { formatInteger, formatMicro } from '../format.js';

const BUCKET_COPY: Readonly<Record<AllocationBucket, { readonly label: string; readonly how: string; readonly color: string }>> = {
  FAN_MINT: { label: 'Mint de Fã', how: 'Pacote pra cada membro novo; cai pela metade a cada era', color: '#3AD6FF' },
  SEASONS: { label: 'Temporadas', how: 'Pago por XP ganho em cada temporada', color: '#BF5AF2' },
  LIQUIDITY: { label: 'Liquidez', how: 'Travado pra liquidez do mercado', color: '#30D158' },
  TREASURY: { label: 'Tesouro', how: 'Travado · vesting 48 meses, cliff 12', color: '#FF9F0A' },
  ECOSYSTEM: { label: 'Ecossistema', how: 'Travado · grants pra parceiros e creators', color: '#FFD60A' },
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
      <section className="glass modal modal--tokenomics" role="dialog" aria-modal="true" aria-label="$NEFA tokenomics" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <div>
            <span className="eyebrow">Tokenomics · ao vivo</span>
            <h2 className="title-md">$NEFA</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>

        <div className="supply">
          <div className="supply__numbers">
            <strong>{formatMicro(tokenomics.mintedMicro, 0)}</strong>
            <span className="caption">de {formatMicro(tokenomics.maxSupplyMicro, 0)} $NEFA no máximo ({pct(tokenomics.mintedMicro, tokenomics.maxSupplyMicro)}%)</span>
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
            <dt>Próximo novato leva</dt>
            <dd>{formatMicro(fanMint.packMicro, 0)}</dd>
          </div>
          <div>
            <dt>O ídolo dele leva</dt>
            <dd>{formatMicro(idolShare.toString(), 0)}</dd>
          </div>
          <div>
            <dt>Era do mint</dt>
            <dd>#{fanMint.era}</dd>
          </div>
          <div>
            <dt>Membros</dt>
            <dd>{formatInteger(fanMint.members)}</dd>
          </div>
          <div>
            <dt>Próximo halving em</dt>
            <dd>{fanMint.nextEraAtMember === null ? '—' : `#${formatInteger(fanMint.nextEraAtMember)}`}</dd>
          </div>
          <div>
            <dt>Prêmio da próxima temporada</dt>
            <dd>{formatMicro(seasons.nextPrizeMicro, 0)}</dd>
          </div>
        </dl>

        {seasons.last && (
          <section className="profile__section" aria-label="Última temporada">
            <h3 className="title-sm">Temporada {seasons.last.season} pagou {formatMicro(seasons.last.paidMicro, 0)} $NEFA</h3>
            <ol className="season-top">
              {seasons.last.top.slice(0, 5).map((w) => (
                <li key={w.handle}>
                  <strong>@{w.handle}</strong>
                  <span className="caption">{formatMicro(w.micro, 2)} $NEFA</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="profile__section" aria-label="Regras">
          <h3 className="title-sm">As regras do jogo</h3>
          <ul className="rules">
            <li>Um pacote por conta do Instagram, pra sempre — e o pacote cai pela metade conforme o planeta cresce: early bird come, farmzinho chora.</li>
            <li>10% de cada pacote vai pro ídolo nomeado: qualquer um pode ser ídolo, então traz gente de verdade.</li>
            <li>Temporadas pagam $NEFA proporcional ao XP. XP tem teto por post e por dia, não se compra, não se vende, e ninguém leva mais de 2% da temporada.</li>
            <li>Marca amigos depois de entrar: +1 XP por amigo novo, uma vez cada, até 20 por dia.</li>
            <li>Supply nunca passa de 100.000.000. Baldes travados o jogo não emite.</li>
          </ul>
        </section>
      </section>
    </div>
  );
};
