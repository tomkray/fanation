/**
 * Soft city ambient under the 3D map. File already has 7s fade in/out;
 * HTMLAudioElement loops forever. Starts with autoplay; gesture is only a fallback
 * when the browser still blocks sound without interaction. Mute + volume persist
 * in localStorage so the discreet chrome control sticks across reloads.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const SRC = '/assets/audio/city-ambient.mp3';
/** Quiet bed so the neon city stays the focus. */
const DEFAULT_VOLUME = 0.14;
const STORAGE_MUTED = 'naoeumfa.ambient.muted';
const STORAGE_VOLUME = 'naoeumfa.ambient.volume';

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_MUTED) === '1';
  } catch {
    return false;
  }
}

function readVolume(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_VOLUME);
    if (raw === null) {
      return DEFAULT_VOLUME;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return DEFAULT_VOLUME;
    }
    return Math.min(1, Math.max(0, n));
  } catch {
    return DEFAULT_VOLUME;
  }
}

function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_MUTED, muted ? '1' : '0');
  } catch {
    // Private mode — preference is session-only.
  }
}

function writeVolume(volume: number): void {
  try {
    window.localStorage.setItem(STORAGE_VOLUME, String(volume));
  } catch {
    // Private mode — preference is session-only.
  }
}

export interface CityAmbientControls {
  readonly muted: boolean;
  readonly volume: number;
  readonly setMuted: (muted: boolean) => void;
  readonly setVolume: (volume: number) => void;
  readonly toggleMute: () => void;
}

export function useCityAmbient(enabled: boolean): CityAmbientControls {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMutedState] = useState(() => (typeof window === 'undefined' ? false : readMuted()));
  const [volume, setVolumeState] = useState(() => (typeof window === 'undefined' ? DEFAULT_VOLUME : readVolume()));
  const mutedRef = useRef(muted);
  const volumeRef = useRef(volume);
  mutedRef.current = muted;
  volumeRef.current = volume;

  const apply = useCallback((nextMuted: boolean, nextVolume: number): void => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.muted = nextMuted;
    audio.volume = nextMuted ? 0 : nextVolume;
  }, []);

  const setMuted = useCallback(
    (next: boolean): void => {
      setMutedState(next);
      writeMuted(next);
      apply(next, volumeRef.current);
    },
    [apply]
  );

  const setVolume = useCallback(
    (next: number): void => {
      const clamped = Math.min(1, Math.max(0, next));
      setVolumeState(clamped);
      writeVolume(clamped);
      if (clamped === 0) {
        setMutedState(true);
        writeMuted(true);
        apply(true, clamped);
        return;
      }
      if (mutedRef.current) {
        setMutedState(false);
        writeMuted(false);
      }
      apply(false, clamped);
    },
    [apply]
  );

  const toggleMute = useCallback((): void => {
    setMuted(!mutedRef.current);
  }, [setMuted]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const audio = new Audio(SRC);
    audio.loop = true;
    audio.preload = 'auto';
    audio.autoplay = true;
    audio.muted = mutedRef.current;
    audio.volume = mutedRef.current ? 0 : volumeRef.current;
    audioRef.current = audio;

    let playing = false;
    const markPlaying = (): void => {
      playing = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };

    const playWithPreference = (): Promise<void> => {
      audio.muted = mutedRef.current;
      audio.volume = mutedRef.current ? 0 : volumeRef.current;
      return audio.play().then(markPlaying);
    };

    /** Autoplay with sound when allowed; else muted start then apply preference. */
    const start = (): void => {
      void playWithPreference().catch(() => {
        audio.muted = true;
        void audio
          .play()
          .then(() => {
            audio.muted = mutedRef.current;
            audio.volume = mutedRef.current ? 0 : volumeRef.current;
            markPlaying();
          })
          .catch(() => {
            // Still blocked — wait for a gesture.
          });
      });
    };

    const unlock = (): void => {
      if (playing) {
        return;
      }
      void playWithPreference().catch(() => {
        // ignore
      });
    };

    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock, { passive: true });
    start();

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audioRef.current = null;
    };
  }, [enabled]);

  return { muted, volume, setMuted, setVolume, toggleMute };
}
