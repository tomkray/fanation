import React from 'react';
import type { WorldSummaryDto } from '../../shared/apiContract.js';
import { formatInteger } from '../format.js';
import { BrandLockup } from './BrandLockup.js';

/** 9:16 overlay the video agent records; mirrors the caption's call to action. */
export const CinematicOverlay: React.FC<{ readonly world: WorldSummaryDto; readonly capture?: boolean }> = ({ world, capture = false }) => {
  const leader = world.standings[0];
  const leaderName = leader && leader.displayName !== `@${leader.fandomHandle}` ? `${leader.displayName} (@${leader.fandomHandle})` : `@${leader?.fandomHandle ?? ''}`;
  return (
    <div className="cinematic">
      <header className="cinematic__top">
        <BrandLockup size="lg" />
        <span className="live-pill">
          <span className="live-dot" /> LIVE
        </span>
      </header>
      <footer className="cinematic__bottom" id="reel-caption">
        {capture ? null : leader && (
          <>
            <span className="eyebrow" style={{ color: leader.neonColorHex }}>
              #1 in the global ranking
            </span>
            <p className="cinematic__headline">{leaderName} leads the planet</p>
            <p className="cinematic__sub">
              {formatInteger(leader.fans)} fans · {formatInteger(leader.reputationXp)} XP · {formatInteger(world.totals.properties)} homes on the planet
            </p>
          </>
        )}
        {capture ? null : <p className="cinematic__cta">Comment your idol&apos;s @ to move in</p>}
      </footer>
    </div>
  );
};
