/**
 * Who someone is, everywhere in the app: their Instagram picture (when the
 * server has it) and their name with the real @handle beside it, so a name can
 * never stand in for a different account.
 */

import React, { createContext, useContext, useState } from 'react';
import { avatarUrl } from '../api/client.js';

/** Kept for layout providers; portraits are always attempted via /api/v1/avatars/:handle. */
export const AvatarsEnabled = createContext(false);

/** Handles Instagram itself marks verified. Empty until the world payload arrives. */
export const InstagramVerified = createContext<ReadonlySet<string>>(new Set());

/** Same blue check Instagram draws beside a verified username. */
export const InstagramBadge: React.FC<{ readonly className?: string }> = ({ className }) => (
  <svg className={className ? `ig-verified ${className}` : 'ig-verified'} viewBox="0 0 40 40" role="img" aria-label="Verificado no Instagram">
    <circle cx="20" cy="20" r="20" fill="#0095F6" />
    <path d="M17.2 27.4 9.8 20l2.6-2.6 4.8 4.8L27.6 11.8 30.2 14.4z" fill="#fff" />
  </svg>
);

function useInstagramVerified(handle: string): boolean {
  return useContext(InstagramVerified).has(handle.trim().toLowerCase().replace(/^@/, ''));
}

type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  readonly handle: string;
  readonly name?: string;
  readonly colorHex?: string;
  readonly size?: AvatarSize;
}

export const Avatar: React.FC<AvatarProps> = ({ handle, name, colorHex = '#3ad6ff', size = 'md' }) => {
  const [attempt, setAttempt] = useState(0);
  const verified = useInstagramVerified(handle);
  // Always try the cache route — seeded portraits work without Discovery; 404 falls back to the initial.
  const picture = attempt < 8 ? avatarUrl(handle) : null;
  const src = picture && attempt > 0 ? `${picture}?r=${attempt}` : picture;
  const initial = (name ?? handle).replace(/^@/, '').slice(0, 1).toUpperCase();
  return (
    <span className={`avatar-wrap avatar-wrap--${size}`}>
      <span className={`avatar avatar--${size}`} style={{ borderColor: colorHex, backgroundColor: src ? undefined : colorHex }} aria-hidden="true">
        {src ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => {
              if (attempt < 7) {
                window.setTimeout(() => setAttempt((n) => n + 1), 4_000);
                return;
              }
              setAttempt(8);
            }}
          />
        ) : (
          initial
        )}
      </span>
      {verified && <InstagramBadge className="ig-verified--on-avatar" />}
    </span>
  );
};

export interface HandleNameProps {
  readonly handle: string;
  /** Display name from the catalogue or Instagram; omitted or equal to the @handle shows the handle alone. */
  readonly name?: string | null;
}

export const HandleName: React.FC<HandleNameProps> = ({ handle, name }) => {
  const hasName = Boolean(name) && name !== `@${handle}`;
  const verified = useInstagramVerified(handle);
  return (
    <span className="identity">
      <strong className="identity__name">
        {hasName ? name : `@${handle}`}
        {verified && <InstagramBadge />}
      </strong>
      {hasName && <span className="identity__handle">@{handle}</span>}
    </span>
  );
};
