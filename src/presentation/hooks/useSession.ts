import { useCallback, useEffect, useState } from 'react';
import type { MeDto } from '../../shared/apiContract.js';
import { api, ApiError } from '../api/client.js';

export interface Session {
  /** The connected profile, or null when nobody is connected. */
  readonly me: MeDto | null;
  readonly loading: boolean;
  readonly refresh: () => void;
  readonly logout: () => Promise<void>;
}

/** The signed-in profile, refreshed whenever the world changes (balances, offers, ownership). */
export function useSession(worldVersion: number): Session {
  const [me, setMe] = useState<MeDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((next) => !cancelled && setMe(next))
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          setMe(null);
        } else {
          console.warn('[naoeumfa] profile refresh failed; keeping the last one', err);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [worldVersion, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const logout = useCallback(async () => {
    await api.logout();
    setMe(null);
  }, []);

  return { me, loading, refresh, logout };
}
