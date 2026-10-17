/**
 * The page a Direct login link opens. It shows which @ the link belongs to and
 * waits for a tap, so a link someone else sent you can never sign you in by
 * surprise.
 */

import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.js';

export interface LinkLoginModalProps {
  readonly token: string;
  readonly onConnected: (handle: string) => void;
  readonly onClose: () => void;
}

export const LinkLoginModal: React.FC<LinkLoginModalProps> = ({ token, onConnected, onClose }) => {
  const [handle, setHandle] = useState<string | null>(null);
  const [state, setState] = useState<'checking' | 'ready' | 'entering' | 'invalid'>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .authLinkPeek(token)
      .then((link) => {
        if (!cancelled) {
          setHandle(link.handle);
          setState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState('invalid');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const enter = async (): Promise<void> => {
    setState('entering');
    setError(null);
    try {
      onConnected((await api.authLinkRedeem(token)).handle);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não rolou entrar.');
      setState('invalid');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="glass modal modal--connect" role="dialog" aria-modal="true" aria-label="Confirmar entrada" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <div>
            <span className="eyebrow">Link do Direct</span>
            <h2 className="title-md">{state === 'invalid' ? 'Link vencido' : handle ? `Entrar como @${handle}?` : 'Conferindo…'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>
        <div className="connect">
          {state === 'invalid' ? (
            <p className="caption">Esse link já foi usado ou passou dos 10 minutos. Manda “entrar” no Direct de novo.</p>
          ) : (
            <p className="caption">Só confirma se essa é a tua @. Se alguém te mandou esse link, fecha aqui.</p>
          )}
          {error && <p className="notice notice--danger">{error}</p>}
          {(state === 'ready' || state === 'entering') && (
            <button type="button" className="button button--primary" disabled={state === 'entering'} onClick={() => void enter()}>
              {state === 'entering' ? 'Entrando…' : `Sou eu, entrar como @${handle}`}
            </button>
          )}
          <button type="button" className="button button--ghost" onClick={onClose}>
            {state === 'invalid' ? 'Fechar' : 'Não sou eu'}
          </button>
        </div>
      </section>
    </div>
  );
};
