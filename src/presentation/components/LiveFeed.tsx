import React, { useEffect, useState } from 'react';
import type { CommentRejectionCode } from '../../core/types.js';
import type { ActivityEntryDto } from '../../shared/apiContract.js';
import { formatInteger, formatMicro, timeAgo } from '../format.js';
import { Avatar } from './Identity.js';

const REJECTION_LABELS: Readonly<Record<CommentRejectionCode, string>> = {
  DUPLICATE_COMMENT_ID: 'Already read',
  OWN_ACCOUNT_COMMENT: 'Official account',
  RATE_LIMIT_EXCEEDED: 'Too fast',
  INVALID_COMMENT_FORMAT: 'Off-format',
  SELF_MINT_FORBIDDEN: 'Self-fandom',
  POST_ALREADY_COUNTED: 'Already scored on this post',
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
          🏠 Moved in next to @{outcome.idolHandle} · fan #{formatInteger(outcome.idolFans)} · +{outcome.xpGained} XP
          {outcome.tokensGrantedMicro && ` · +${formatMicro(outcome.tokensGrantedMicro, 0)} $FANT`}
        </span>
      );
    case 'ENGAGEMENT_POINTS_ONLY':
      return outcome.newFan ? (
        <span className="badge badge--accent">
          💜 Now fan #{formatInteger(outcome.idolFans)} of @{outcome.idolHandle} · +{outcome.xpGained} XP
        </span>
      ) : (
        <span className="badge badge--accent">
          ⚡ +{outcome.xpGained} XP for @{outcome.idolHandle}
        </span>
      );
    case 'REJECTED':
      return <span className="badge badge--muted">Ignored · {REJECTION_LABELS[outcome.code]}</span>;
    default: {
      const exhaustive: never = outcome;
      return <span>{String(exhaustive)}</span>;
    }
  }
}

export const LiveFeed: React.FC<LiveFeedProps> = ({ entries, pollIntervalSeconds, onFocusLand, onAdvertise }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="glass panel panel--feed" aria-label="Live Instagram comments">
      <header className="panel__header">
        <span className="eyebrow">Live · Instagram</span>
        <h2 className="title-sm">Incoming comments</h2>
        <p className="feed__cta">
          Comment <strong>@your_idol</strong> on @fanation.club to move in next to them
          {pollIntervalSeconds !== null && <span className="caption"> · read every {pollIntervalSeconds}s</span>}
        </p>
        <button type="button" className="link-button feed__advertise" onClick={onAdvertise}>
          Brands: put your ad on a zeppelin →
        </button>
      </header>
      <ol className="feed" role="log" aria-live="polite">
        {entries.length === 0 && <li className="caption">Waiting for the first comment…</li>}
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
                  <strong>@{entry.authorUsername}</strong>
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
