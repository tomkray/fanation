/**
 * Rankings, gamified. Idols: the single global ranking with positions
 * gained/lost and score change versus the momentum window, a flash plus a
 * sliding reorder the moment someone overtakes, category filters, top movers
 * and a climb ticker. People: top reputation (XP) and top $NEFA balances.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FandomCategory } from '../../core/types.js';
import type { RankChangeDto, StandingDto, UserRankDto } from '../../shared/apiContract.js';
import { architectureBand, visualClassFor } from '../../core/architecture.js';
import { CLASS_LABELS, formatCompact, formatInteger, formatMicro, formatPct, formatWindow, RARITY_LABELS, timeAgo } from '../format.js';
import { Avatar } from './Identity.js';

type Filter = 'ALL' | FandomCategory;
type View = 'idols' | 'xp' | 'tokens';

const FILTERS: readonly { readonly id: Filter; readonly label: string }[] = [
  { id: 'ALL', label: 'Tudo' },
  { id: 'ARTIST', label: 'Artistas' },
  { id: 'CLUB', label: 'Clubes' },
  { id: 'INFLUENCER', label: 'Creators' },
  { id: 'ATHLETE', label: 'Atletas' },
  { id: 'UNLISTED', label: 'Comunidade' },
];

const FLASH_MS = 1_600;
const REORDER_MS = 520;

function RankDelta({ movement }: { readonly movement: StandingDto['movement'] }): React.ReactElement {
  if (movement.isNew) {
    return <span className="lb-delta lb-delta--new">NOVO</span>;
  }
  if (movement.rankDelta > 0) {
    return <span className="lb-delta lb-delta--up" aria-label={`subiu ${movement.rankDelta}`}>▲{movement.rankDelta}</span>;
  }
  if (movement.rankDelta < 0) {
    return <span className="lb-delta lb-delta--down" aria-label={`desceu ${-movement.rankDelta}`}>▼{-movement.rankDelta}</span>;
  }
  return <span className="lb-delta lb-delta--flat" aria-label="sem mudança">–</span>;
}

function ScoreChange({ pct }: { readonly pct: number | null }): React.ReactElement {
  if (pct === null || pct === 0) {
    return <span className="lb-pct lb-pct--flat">—</span>;
  }
  return pct > 0 ? <span className="lb-pct lb-pct--up">▲ {formatPct(pct)}</span> : <span className="lb-pct lb-pct--down">▼ {formatPct(pct)}</span>;
}

/** FLIP: rows slide from their old slot to the new one instead of jumping. */
function useSlidingRows(deps: unknown): (key: string) => (el: HTMLLIElement | null) => void {
  const elements = useRef(new Map<string, HTMLLIElement>());
  const previousTops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const tops = new Map<string, number>();
    for (const [key, el] of elements.current) {
      const top = el.offsetTop;
      tops.set(key, top);
      const before = previousTops.current.get(key);
      if (before !== undefined && before !== top) {
        el.style.transition = 'none';
        el.style.transform = `translateY(${before - top}px)`;
        requestAnimationFrame(() => {
          el.style.transition = `transform ${REORDER_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
          el.style.transform = '';
        });
      }
    }
    previousTops.current = tops;
  }, [deps]);
  return (key) => (el) => {
    if (el) {
      elements.current.set(key, el);
    } else {
      elements.current.delete(key);
    }
  };
}

export interface LeaderboardProps {
  readonly standings: readonly StandingDto[];
  readonly rankChanges: readonly RankChangeDto[];
  readonly topByXp: readonly UserRankDto[];
  readonly topByTokens: readonly UserRankDto[];
  readonly momentumWindowSeconds: number;
  readonly onFocusHandle: (handle: string) => void;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ standings, rankChanges, topByXp, topByTokens, momentumWindowSeconds, onFocusHandle }) => {
  const [view, setView] = useState<View>('idols');
  const [filter, setFilter] = useState<Filter>('ALL');
  const standingsByHandle = useMemo(() => new Map(standings.map((s) => [s.fandomHandle, s])), [standings]);
  const [flashes, setFlashes] = useState<ReadonlyMap<string, 'up' | 'down'>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const previousRanks = useRef(new Map<string, number>());

  const rows = useMemo(() => (filter === 'ALL' ? standings : standings.filter((s) => s.category === filter)), [standings, filter]);
  const counts = useMemo(() => {
    const result = new Map<Filter, number>([['ALL', standings.length]]);
    for (const s of standings) {
      result.set(s.category, (result.get(s.category) ?? 0) + 1);
    }
    return result;
  }, [standings]);
  const { climber, faller } = useMemo(() => {
    const byClimb = standings
      .filter((s) => !s.movement.isNew)
      .sort((a, b) => b.movement.rankDelta - a.movement.rankDelta || (b.movement.scoreDeltaPct ?? 0) - (a.movement.scoreDeltaPct ?? 0));
    const first = byClimb[0];
    const last = byClimb[byClimb.length - 1];
    return {
      climber: first && first.movement.rankDelta > 0 ? first : undefined,
      faller: last && last.movement.rankDelta < 0 ? last : undefined,
    };
  }, [standings]);

  // Flash every idol whose live position just changed.
  useEffect(() => {
    const next = new Map<string, 'up' | 'down'>();
    for (const s of standings) {
      const before = previousRanks.current.get(s.fandomHandle);
      if (before !== undefined && before !== s.rankPosition) {
        next.set(s.fandomHandle, s.rankPosition < before ? 'up' : 'down');
      }
    }
    previousRanks.current = new Map(standings.map((s) => [s.fandomHandle, s.rankPosition]));
    if (next.size === 0) {
      return undefined;
    }
    setFlashes(next);
    const id = window.setTimeout(() => setFlashes(new Map()), FLASH_MS);
    return () => window.clearTimeout(id);
  }, [standings]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  const slideIdol = useSlidingRows(rows);
  const slideUser = useSlidingRows(view === 'xp' ? topByXp : topByTokens);
  const people = view === 'xp' ? topByXp : topByTokens;

  return (
    <section className="glass panel panel--league" aria-label="Rankings">
      <header className="panel__header">
        <span className="eyebrow">Ranking global · ao vivo</span>
        <h2 className="title-sm">Quem tá voando</h2>
        <p className="caption">
          {view === 'idols'
            ? `XP que os fãs renderam pra cada ídolo · movimento vs ${formatWindow(momentumWindowSeconds)} atrás`
            : view === 'xp'
              ? 'XP se ganha jogando — e não se vende. Zero negociata.'
              : 'Saldo $NEFA negociável (a moeda do rolê)'}
        </p>
      </header>

      <div className="segmented segmented--compact" role="tablist" aria-label="Ranking">
        {(
          [
            ['idols', 'Ídolos'],
            ['xp', 'Top XP'],
            ['tokens', 'Top $NEFA'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className="segmented__item" onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </div>

      {view === 'idols' && (
        <>
          <label className="lb-filter">
            <span className="visually-hidden">Category</span>
            <select className="field__input lb-filter__select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              {FILTERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label} ({counts.get(f.id) ?? 0})
                </option>
              ))}
            </select>
          </label>

          {(climber || faller || rankChanges.length > 0) && (
            <p className="lb-moves" aria-live="polite">
              {climber && (
                <button type="button" className="lb-move lb-move--up" onClick={() => onFocusHandle(climber.fandomHandle)}>
                  ▲{climber.movement.rankDelta} @{climber.fandomHandle} → #{climber.rankPosition}
                </button>
              )}
              {faller && (
                <button type="button" className="lb-move lb-move--down" onClick={() => onFocusHandle(faller.fandomHandle)}>
                  ▼{-faller.movement.rankDelta} @{faller.fandomHandle} → #{faller.rankPosition}
                </button>
              )}
              {rankChanges[0] && (
                <span className="caption">
                  {rankChanges[0].toRank === 1 ? `@${rankChanges[0].fandomHandle} assumiu o #1` : `@${rankChanges[0].fandomHandle} subiu pro #${rankChanges[0].toRank}`} · {timeAgo(rankChanges[0].atIso, now)}
                </span>
              )}
            </p>
          )}

          <ol className="league leaderboard">
            {rows.length === 0 && <li className="caption">Nenhum ídolo nessa categoria ainda. Alguém abre o jogo?</li>}
            {rows.map((idol) => {
              const flash = flashes.get(idol.fandomHandle);
              return (
                <li key={idol.fandomHandle} ref={slideIdol(idol.fandomHandle)}>
                  <button type="button" className={`lb-row${flash ? ` lb-row--flash-${flash}` : ''}`} onClick={() => onFocusHandle(idol.fandomHandle)}>
                    <span className={`lb-rank${idol.rankPosition <= 3 ? ` lb-rank--podium-${idol.rankPosition}` : ''}`}>{idol.rankPosition}</span>
                    <RankDelta movement={idol.movement} />
                    <Avatar handle={idol.fandomHandle} name={idol.displayName} colorHex={idol.neonColorHex} />
                    <span className="league__name">
                      <strong>{idol.displayName}</strong>
                      <span className="caption">
                        {idol.displayName !== `@${idol.fandomHandle}` && <span className="identity__handle">@{idol.fandomHandle} · </span>}
                        {RARITY_LABELS[architectureBand(visualClassFor(idol.fans, idol.footprint)).rarity]} · {CLASS_LABELS[idol.propertyClass]} · {formatCompact(idol.fans)} fãs
                      </span>
                    </span>
                    <span className="league__stats" title={`${formatInteger(idol.reputationXp)} XP`}>
                      <strong>{formatCompact(idol.reputationXp)} XP</strong>
                      <ScoreChange pct={idol.movement.scoreDeltaPct} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {view !== 'idols' && (
        <ol className="league leaderboard">
          {people.length === 0 && <li className="caption">Ninguém ainda. Seja o plot twist.</li>}
          {people.map((person, index) => {
            const idol = person.fandomHandle ? standingsByHandle.get(person.fandomHandle) : undefined;
            const accent = idol?.neonColorHex;
            return (
              <li key={person.handle} ref={slideUser(person.handle)}>
                <button type="button" className="lb-row lb-row--fan" onClick={() => onFocusHandle(person.handle)}>
                  <span className={`lb-rank${index < 3 ? ` lb-rank--podium-${index + 1}` : ''}`}>{index + 1}</span>
                  <Avatar handle={person.handle} colorHex={accent} />
                  <span className="league__name">
                    <span className="identity">
                      <strong className="identity__name">@{person.handle}</strong>
                      <span className="level-badge" style={{ borderColor: accent }}>
                        Nv {person.level}
                      </span>
                    </span>
                    <span className="xp-bar" aria-hidden="true">
                      <span className="xp-bar__fill" style={{ width: `${Math.round(person.levelProgress * 100)}%`, backgroundColor: accent }} />
                    </span>
                    <span className="caption">
                      {person.fans > 0 ? `${formatInteger(person.fans)} fãs · ` : ''}
                      {person.fandomHandle ? `fã de ${idol && idol.displayName !== `@${idol.fandomHandle}` ? `${idol.displayName} ` : ''}@${person.fandomHandle}` : 'Ídolo'}
                    </span>
                  </span>
                  <span className="league__stats">
                    <strong>{view === 'xp' ? `${formatInteger(person.reputationXp)} XP` : `${formatMicro(person.tokenBalanceMicro, 0)} $NEFA`}</strong>
                    {person.propertyClass && <span className="caption">{CLASS_LABELS[person.propertyClass]}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};
