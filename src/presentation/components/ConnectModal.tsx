/**
 * Connect your Instagram (A10): no password, no app review. We show a
 * one-time code; you comment it on any @fanation.club post; Meta tells us who
 * wrote it, and this browser is signed in as that @.
 */

import React, { useEffect, useState } from 'react';
import type { AuthChallengeDto } from '../../shared/apiContract.js';
import { api, ApiError } from '../api/client.js';

const POLL_MS = 3_000;

export interface ConnectModalProps {
  readonly onConnected: (handle: string) => void;
  readonly onClose: () => void;
}

export const ConnectModal: React.FC<ConnectModalProps> = ({ onConnected, onClose }) => {
  const [handle, setHandle] = useState('');
  const [challenge, setChallenge] = useState<AuthChallengeDto | null>(null);
  const [state, setState] = useState<'idle' | 'asking' | 'waiting' | 'expired'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state !== 'waiting') {
      return undefined;
    }
    let cancelled = false;
    const poll = (): void => {
      api
        .authStatus()
        .then((status) => {
          if (cancelled) {
            return;
          }
          if (status.state === 'VERIFIED' && status.handle) {
            onConnected(status.handle);
          } else if (status.state === 'EXPIRED' || status.state === 'NONE') {
            setState('expired');
          }
        })
        .catch(() => undefined); // A missed poll is retried on the next tick.
    };
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [state, onConnected]);

  const ask = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setState('asking');
    try {
      setChallenge(await api.authChallenge(handle));
      setState('waiting');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create a code.');
      setState('idle');
    }
  };

  const copy = async (): Promise<void> => {
    if (!challenge) {
      return;
    }
    try {
      await navigator.clipboard.writeText(challenge.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError('Copy failed; type the code instead.');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="glass modal modal--connect" role="dialog" aria-modal="true" aria-label="Connect your Instagram" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <div>
            <span className="eyebrow">Your profile wallet</span>
            <h2 className="title-md">Connect your Instagram</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {state === 'idle' || state === 'asking' ? (
          <form className="connect" onSubmit={(e) => void ask(e)}>
            <p className="caption">
              No password. You prove the @ is yours by commenting a one-time code on Instagram — the same place where your fan
              life already happens.
            </p>
            <label className="field">
              <span className="caption">Your Instagram @</span>
              <input
                className="field__input"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@your_username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={31}
                required
              />
            </label>
            {error && <p className="notice notice--danger">{error}</p>}
            <button type="submit" className="button button--primary" disabled={state === 'asking'}>
              {state === 'asking' ? 'Creating your code…' : 'Get my code'}
            </button>
          </form>
        ) : (
          <div className="connect">
            <ol className="connect__steps">
              <li>
                <span className="caption">1 · Copy your code</span>
                <button type="button" className="connect__code" onClick={() => void copy()} aria-label="Copy code">
                  {challenge?.code}
                </button>
                <span className="caption">{copied ? 'Copied ✓' : 'Tap to copy · valid for 15 minutes · works once'}</span>
              </li>
              <li>
                <span className="caption">2 · Comment it from @{challenge?.handle}</span>
                <a className="button button--secondary" href={`https://www.instagram.com/${challenge?.officialHandle ?? 'fanation.club'}/`} target="_blank" rel="noreferrer noopener">
                  Open @{challenge?.officialHandle} on Instagram
                </a>
                <span className="caption">On any post. Only a comment written by @{challenge?.handle} unlocks this profile.</span>
              </li>
              <li>
                <span className="caption">3 · Come back here</span>
                {state === 'expired' ? (
                  <p className="notice notice--warning">The code expired. Ask for a new one.</p>
                ) : (
                  <p className="connect__waiting">
                    <span className="live-dot" /> Waiting for your comment…
                  </p>
                )}
              </li>
            </ol>
            {challenge?.canSimulate && state === 'waiting' && (
              <button type="button" className="button button--ghost" onClick={() => void api.authSimulate().catch(() => setError('Simulation failed.'))}>
                Demo: post the comment for me
              </button>
            )}
            {error && <p className="notice notice--danger">{error}</p>}
            {state === 'expired' && (
              <button type="button" className="button button--primary" onClick={() => setState('idle')}>
                New code
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
