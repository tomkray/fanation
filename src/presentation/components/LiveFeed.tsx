import React, { useContext, useEffect, useState } from 'react';
import type { CommentRejectionCode } from '../../core/types.js';
import type { ActivityEntryDto } from '../../shared/apiContract.js';
import { formatInteger, formatMicro, timeAgo } from '../format.js';
import { Avatar, InstagramBadge, InstagramVerified } from './Identity.js';

const REJECTION_LABELS: Readonly<Record<CommentRejectionCode, string>> = {
  DUPLICATE_COMMENT_ID: 'Já li esse',
  OWN_ACCOUNT_COMMENT: 'Conta oficial',
  RATE_LIMIT_EXCEEDED: 'Calma, speeder',
  INVALID_COMMENT_FORMAT: 'Formato errado',
  SELF_MINT_FORBIDDEN: 'Autofan? Negativo',
  POST_ALREADY_COUNTED: 'Já pontuou nesse post',
};

export interface LiveFeedProps {
  readonly entries: readonly ActivityEntryDto[];
  readonly pollIntervalSeconds: number | null;
  readonly onFocusLand: (plotIndex: number) => void;
  readonly onAdvertise: () => void;
}

function Outcome({ entry }: { readonly entry: ActivityEntryDto }): React.ReactElement {
  const { outcome } = entry;
  switch (outcome.status) {
    case 'MINTED_NEW_LAND':
      return (
        <span className="badge badge--success">
          🏠 Se mudou pro lado de @{outcome.idolHandle} · fã #{formatInteger(outcome.idolFans)} · +{outcome.xpGained} XP
          {outcome.tokensGrantedMicro && ` · +${formatMicro(outcome.tokensGrantedMicro, 0)} $NEFA`}
        </span>
      );
    case 'ENGAGEMENT_POINTS_ONLY':
      return outcome.newFan ? (
        <span className="badge badge--accent">
          💜 Agora é fã #{formatInteger(outcome.idolFans)} de @{outcome.idolHandle} · +{outcome.xpGained} XP
        </span>
      ) : (
        <span className="badge badge--accent">
          ⚡ +{outcome.xpGained} XP pra @{outcome.idolHandle}
        </span>
      );
    case 'REJECTED':
      return <span className="badge badge--muted">Ignorado · {REJECTION_LABELS[outcome.code]}</span>;
    default: {
      const exhaustive: never = outcome;
      return <span>{String(exhaustive)}</span>;
    }
  }
}

export const LiveFeed: React.FC<LiveFeedProps> = ({ entries, pollIntervalSeconds, onFocusLand, onAdvertise }) => {
  const verified = useContext(InstagramVerified);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="glass panel panel--feed" aria-label="Comentários ao vivo do Instagram">
      <header className="panel__header">
        <span className="eyebrow">Ao vivo · Instagram</span>
        <h2 className="title-sm">Comentários chegando</h2>
        <p className="feed__cta">
          Comenta <strong>@seu_idolo</strong> no @naoeumfa e muda pro lado dele
          {pollIntervalSeconds !== null && <span className="caption"> · lendo a cada {pollIntervalSeconds}s</span>}
        </p>
        <button type="button" className="link-button feed__advertise" onClick={onAdvertise}>
          Marcas: anúncio no zepelim →
        </button>
      </header>
      <ol className="feed" role="log" aria-live="polite">
        {entries.length === 0 && <li className="caption">Esperando o primeiro comentário… o silêncio também é plot.</li>}
        {entries.map((entry) => {
          const plot =
            entry.outcome.status === 'MINTED_NEW_LAND' || entry.outcome.status === 'ENGAGEMENT_POINTS_ONLY'
              ? entry.outcome.plotIndex
              : null;
          const content = (
            <>
              <Avatar handle={entry.authorUsername.toLowerCase()} />
              <span className="feed__body">
                <span className="feed__meta">
                  <strong>
                    @{entry.authorUsername}
                    {verified.has(entry.authorUsername.toLowerCase()) && <InstagramBadge />}
                  </strong>
                  <span className="caption">{timeAgo(entry.atIso, now)}</span>
                </span>
                <span className="feed__text">{entry.text}</span>
                <Outcome entry={entry} />
              </span>
            </>
          );
          return (
            <li key={entry.commentId} className="feed__item">
              {plot !== null ? (
                <button type="button" className="feed__button" onClick={() => onFocusLand(plot)}>
                  {content}
                </button>
              ) : (
                <div className="feed__button feed__button--static">{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
};
