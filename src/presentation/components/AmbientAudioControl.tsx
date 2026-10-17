/**
 * Discreet mute + volume for the city ambient bed. Lives in the top bar as a
 * small speaker; the slider opens on focus/hover so the chrome stays quiet.
 */

import React, { useId, useState } from 'react';
import type { CityAmbientControls } from '../hooks/useCityAmbient.js';

interface Props {
  readonly ambient: CityAmbientControls;
}

export const AmbientAudioControl: React.FC<Props> = ({ ambient }) => {
  const { muted, volume, setVolume, toggleMute } = ambient;
  const [open, setOpen] = useState(false);
  const sliderId = useId();
  const silent = muted || volume === 0;
  const level = Math.round((silent ? 0 : volume) * 100);

  return (
    <div
      className={`ambient-audio${open ? ' ambient-audio--open' : ''}${silent ? ' ambient-audio--muted' : ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="ambient-audio__toggle"
        aria-pressed={silent}
        aria-label={silent ? 'Ativar som da cidade' : 'Silenciar som da cidade'}
        title={silent ? 'Som' : 'Mudo'}
        onClick={toggleMute}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M4 9v6h3.2L12 19V5L7.2 9H4z"
            fill="currentColor"
          />
          {silent ? (
            <path d="M15.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          ) : (
            <>
              <path d="M15 9.2a3.2 3.2 0 0 1 0 5.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              {volume > 0.35 && (
                <path d="M17.2 7a5.4 5.4 0 0 1 0 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              )}
            </>
          )}
        </svg>
      </button>
      <label className="ambient-audio__slider" htmlFor={sliderId}>
        <span className="visually-hidden">Volume da cidade</span>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={level}
          aria-valuetext={`${level}%`}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
        />
      </label>
    </div>
  );
};
