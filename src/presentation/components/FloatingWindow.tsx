/**
 * A card that opens in the middle of the screen, can be dragged by its band
 * and closed (× or Escape). It never leaves the viewport: at least its band
 * stays reachable so it can always be dragged back or closed.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

const KEEP_VISIBLE_PX = 72;

export interface FloatingWindowProps {
  readonly label: string;
  /** The coloured band at the top; it is also the drag handle. */
  readonly band: React.ReactNode;
  readonly accentHex: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}

export const FloatingWindow: React.FC<FloatingWindowProps> = ({ label, band, accentHex, onClose, children }) => {
  const [position, setPosition] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const drag = useRef<{ readonly dx: number; readonly dy: number } | null>(null);
  const node = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const clamp = useCallback((x: number, y: number) => {
    const width = node.current?.offsetWidth ?? 360;
    return {
      x: Math.min(window.innerWidth - KEEP_VISIBLE_PX, Math.max(KEEP_VISIBLE_PX - width, x)),
      y: Math.min(window.innerHeight - KEEP_VISIBLE_PX, Math.max(0, y)),
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>): void => {
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    const rect = node.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>): void => {
    if (drag.current) {
      setPosition(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLElement>): void => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <section
      ref={node}
      className={`floating-window${position ? ' floating-window--moved' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      style={position ? { left: position.x, top: position.y, borderColor: accentHex } : { borderColor: accentHex }}
    >
      <header
        className="floating-window__band"
        style={{ background: `linear-gradient(135deg, ${accentHex}, ${accentHex}cc)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="floating-window__band-content">{band}</div>
        <button type="button" className="floating-window__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className="floating-window__body">{children}</div>
    </section>
  );
};
