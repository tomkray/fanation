/**
 * Who someone is, everywhere in the app: their Instagram picture (when the
 * server has it) and their name with the real @handle beside it, so a name can
 * never stand in for a different account.
 */

import React, { createContext, useState } from 'react';
import { avatarUrl } from '../api/client.js';

/** Kept for layout providers; portraits are always attempted via /api/v1/avatars/:handle. */
export const AvatarsEnabled = createContext(false);

type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  readonly handle: string;
  readonly name?: string;
  readonly colorHex?: string;
  readonly size?: AvatarSize;
}

export const Avatar: React.FC<AvatarProps> = ({ handle, name, colorHex = '#3ad6ff', size = 'md' }) => {
  const [attempt, setAttempt] = useState(0);
  // Always try the cache route — seeded portraits work without Discovery; 404 falls back to the initial.
  const picture = attempt < 2 ? avatarUrl(handle) : null;
  const src = picture && attempt > 0 ? `${picture}?r=1` : picture;
  const initial = (name ?? handle).replace(/^@/, '').slice(0, 1).toUpperCase();
  return (
    <span className={`avatar avatar--${size}`} style={{ borderColor: colorHex, backgroundColor: src ? undefined : colorHex }} aria-hidden="true">
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => {
            if (attempt === 0) {
              window.setTimeout(() => setAttempt(1), 4_000);
              return;
            }
            setAttempt(2);
          }}
        />
      ) : (
        initial
      )}
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
  return (
    <span className="identity">
      <strong className="identity__name">{hasName ? name : `@${handle}`}</strong>
      {hasName && <span className="identity__handle">@{handle}</span>}
    </span>
  );
};
