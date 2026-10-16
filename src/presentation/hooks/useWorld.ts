import { useEffect, useRef, useState } from 'react';
import type { PropertyDto, PublicConfigDto, WorldSummaryDto } from '../../shared/apiContract.js';
import { api, StreamStatus, subscribeWorldStream } from '../api/client.js';

const FALLBACK_POLL_MS = 15_000;

export type PropertiesMode = 'load' | 'live' | 'reset';
export type PropertiesListener = (properties: readonly PropertyDto[], mode: PropertiesMode) => void;

/**
 * The properties the browser holds: only the chunks the camera asked for,
 * kept current by the change feed. Never the whole world, so a planet of
 * millions costs the same as a city of thousands.
 */
export class WorldStore {
  private readonly loaded = new Set<string>();
  private readonly pending = new Set<string>();
  private readonly listeners = new Set<PropertiesListener>();
  private wanted: readonly string[] = [];
  /** Version the shown properties are current to; -1 until the first summary. */
  private version = -1;

  subscribe(listener: PropertiesListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get pendingChunks(): number {
    return this.pending.size;
  }

  setBaseline(version: number): void {
    if (this.version < 0) {
      this.version = version;
    }
  }

  /** Loads the chunks that are not in memory yet (the server caps a request at 64). */
  async show(keys: readonly string[]): Promise<void> {
    this.wanted = keys;
    const missing = keys.filter((k) => !this.loaded.has(k) && !this.pending.has(k)).slice(0, 64);
    if (missing.length === 0) {
      return;
    }
    missing.forEach((k) => this.pending.add(k));
    try {
      const result = await api.chunks(missing);
      result.chunks.forEach((c) => this.loaded.add(c.key));
      this.emit(
        result.chunks.flatMap((c) => c.properties),
        'load'
      );
    } finally {
      missing.forEach((k) => this.pending.delete(k));
    }
  }

  /** Applies everything that changed since the shown version; reloads when the feed has moved on too far. */
  async catchUp(): Promise<void> {
    if (this.version < 0) {
      return;
    }
    const changes = await api.changes(this.version);
    if (changes.reset) {
      this.loaded.clear();
      this.version = changes.version;
      this.emit([], 'reset');
      await this.show(this.wanted);
      return;
    }
    this.version = Math.max(this.version, changes.version);
    if (changes.properties.length > 0) {
      this.emit(changes.properties, 'live');
    }
    // Retries any chunk whose earlier load failed (network blip).
    await this.show(this.wanted);
  }

  private emit(properties: readonly PropertyDto[], mode: PropertiesMode): void {
    for (const listener of this.listeners) {
      listener(properties, mode);
    }
  }
}

export interface LiveWorld {
  readonly config: PublicConfigDto | null;
  readonly summary: WorldSummaryDto | null;
  readonly store: WorldStore;
  readonly status: StreamStatus;
  readonly error: string | null;
}

/**
 * Summary + live stream. Stream events only carry a version; a newer version
 * triggers one summary fetch and one change-feed catch-up, and bursts collapse
 * into a single trailing refresh. With `live: false` the world is fetched once
 * and frozen (video capture).
 */
export function useWorld({ live }: { readonly live: boolean } = { live: true }): LiveWorld {
  const [config, setConfig] = useState<PublicConfigDto | null>(null);
  const [summary, setSummary] = useState<WorldSummaryDto | null>(null);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [store] = useState(() => new WorldStore());
  const versionRef = useRef(-1);

  useEffect(() => {
    // Per-mount flags: a remount (StrictMode, HMR) must not inherit the
    // previous mount's in-flight fetch, whose result it will discard.
    let cancelled = false;
    let inFlight = false;
    let dirty = false;

    const refresh = async (): Promise<void> => {
      if (inFlight) {
        dirty = true;
        return;
      }
      inFlight = true;
      try {
        const next = await api.world();
        if (!cancelled && next.version >= versionRef.current) {
          versionRef.current = next.version;
          store.setBaseline(next.version);
          setSummary(next);
          setError(null);
        }
        if (!cancelled && live) {
          await store.catchUp();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load the world.');
        }
      } finally {
        inFlight = false;
        if (dirty && !cancelled) {
          dirty = false;
          void refresh();
        }
      }
    };

    api
      .config()
      .then((c) => !cancelled && setConfig(c))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load the configuration.'));
    void refresh();
    if (!live) {
      setStatus('live');
      return () => {
        cancelled = true;
      };
    }

    const unsubscribe = subscribeWorldStream(
      (version) => {
        if (version > versionRef.current) {
          void refresh();
        }
      },
      (s) => !cancelled && setStatus(s)
    );
    const poll = window.setInterval(() => void refresh(), FALLBACK_POLL_MS);

    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [live, store]);

  return { config, summary, store, status, error };
}
