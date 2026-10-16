/**
 * Soft city ambient under the 3D map. File already has 7s fade in/out;
 * HTMLAudioElement loops forever. Starts with autoplay; gesture is only a fallback
 * when the browser still blocks sound without interaction.
 */

import { useEffect, useRef } from 'react';

const SRC = '/assets/audio/city-ambient.mp3';
/** Quiet bed so the neon city stays the focus. */
const VOLUME = 0.14;

export function useCityAmbient(enabled: boolean): void {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const audio = new Audio(SRC);
    audio.loop = true;
    audio.preload = 'auto';
    audio.autoplay = true;
    audio.volume = VOLUME;
    audioRef.current = audio;

    let playing = false;
    const markPlaying = (): void => {
      playing = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };

    const playLoud = (): Promise<void> => {
      audio.muted = false;
      audio.volume = VOLUME;
      return audio.play().then(markPlaying);
    };

    /** Autoplay with sound when allowed; else muted start then unmute (policy path). */
    const start = (): void => {
      void playLoud().catch(() => {
        audio.muted = true;
        void audio
          .play()
          .then(() => {
            audio.muted = false;
            audio.volume = VOLUME;
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
      void playLoud().catch(() => {
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
}
