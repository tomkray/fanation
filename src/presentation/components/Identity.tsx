/**
 * Who someone is, everywhere in the app: their Instagram picture (when the
 * server has it) and their name with the real @handle beside it, so a name can
 * never stand in for a different account.
 */

import React, { createContext, useContext, useState } from 'react';
import { avatarUrl } from '../api/client.js';

/** True when the server serves profile pictures (PublicConfigDto.avatars). */
export const AvatarsEnabled = createContext(false);

type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  readonly handle: string;
  readonly name?: string;
  readonly colorHex?: string;
  readonly size?: AvatarSize;
}

export const Avatar: React.FC<AvatarProps> = ({ handle, name, colorHex = '#3ad6ff', size = 'md' }) => {
  const enabled = useContext(AvatarsEnabled);
  const [failed, setFailed] = useState(false);
  const src = enabled && !failed ? avatarUrl(handle) : null;
  const initial = (name ?? handle).replace(/^@/, '').slice(0, 1).toUpperCase();
  return (
    <span className={`avatar avatar--${size}`} style={{ borderColor: colorHex, backgroundColor: src ? undefined : colorHex }} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : initial}
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
