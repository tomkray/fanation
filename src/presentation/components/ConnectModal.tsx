/**
 * Conecta teu Instagram (A10): sem senha, sem app review. Mostramos um código
 * único; você comenta no @naoeumfa; a Meta diz quem escreveu e o browser vira
 * essa @.
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
        .catch(() => undefined);
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
      setError(err instanceof ApiError ? err.message : 'Não rolou criar o código.');
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
      setError('Não copiou — digita o código na mão.');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="glass modal modal--connect" role="dialog" aria-modal="true" aria-label="Conectar Instagram" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <div>
            <span className="eyebrow">Carteira do perfil</span>
            <h2 className="title-md">Conecta teu Instagram</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>

        {state === 'idle' || state === 'asking' ? (
          <form className="connect" onSubmit={(e) => void ask(e)}>
            <p className="caption">
              Sem senha nossa. O Instagram é quem diz que o comentário saiu da tua @. O código vale 15 minutos, uma vez, e só conta
              quando a Meta entrega esse comentário. Colar o @ aqui não entra.
            </p>
            <label className="field">
              <span className="caption">Tua @ do Instagram</span>
              <input
                className="field__input"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@seu_usuario"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={31}
                required
              />
            </label>
            {error && <p className="notice notice--danger">{error}</p>}
            <button type="submit" className="button button--primary" disabled={state === 'asking'}>
              {state === 'asking' ? 'Gerando código…' : 'Quero meu código'}
            </button>
          </form>
        ) : (
          <div className="connect">
            <ol className="connect__steps">
              <li>
                <span className="caption">1 · Copia o código</span>
                <button type="button" className="connect__code" onClick={() => void copy()} aria-label="Copiar código">
                  {challenge?.code}
                </button>
                <span className="caption">{copied ? 'Copiado ✓' : 'Toca pra copiar · vale 15 min · uma vez só'}</span>
              </li>
              <li>
                <span className="caption">2 · Comenta com @{challenge?.handle}</span>
                <a className="button button--secondary" href={`https://www.instagram.com/${challenge?.officialHandle ?? 'naoeumfa'}/`} target="_blank" rel="noreferrer noopener">
                  Abrir @{challenge?.officialHandle} no Instagram
                </a>
                <span className="caption">Em qualquer post do @{challenge?.officialHandle}. Só a Meta, dizendo que foi @{challenge?.handle}, destrava o perfil.</span>
              </li>
              <li>
                <span className="caption">3 · Volta aqui</span>
                {state === 'expired' ? (
                  <p className="notice notice--warning">Código expirou. Pede outro.</p>
                ) : (
                  <p className="connect__waiting">
                    <span className="live-dot" /> Esperando teu comentário…
                  </p>
                )}
              </li>
            </ol>
            {challenge?.canSimulate && state === 'waiting' && (
              <button type="button" className="button button--ghost" onClick={() => void api.authSimulate().catch(() => setError('Simulação falhou.'))}>
                Demo: posta o comentário por mim
              </button>
            )}
            {error && <p className="notice notice--danger">{error}</p>}
            {state === 'expired' && (
              <button type="button" className="button button--primary" onClick={() => setState('idle')}>
                Novo código
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
