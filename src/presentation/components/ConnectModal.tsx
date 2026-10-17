/**
 * Entrar (A10): manda "entrar" no Direct do @naoeumfa e a gente responde com
 * um link de uso único. Só quem lê o próprio Direct recebe esse link.
 */

import React, { useState } from 'react';
import type { PublicConfigDto } from '../../shared/apiContract.js';
import { api, ApiError } from '../api/client.js';

export interface ConnectModalProps {
  readonly login: PublicConfigDto['login'] | null;
  /** Demo only: a link issued without Instagram goes through the same confirm step. */
  readonly onDemoLink: (token: string) => void;
  readonly onClose: () => void;
}

export const ConnectModal: React.FC<ConnectModalProps> = ({ login, onDemoLink, onClose }) => {
  const official = login?.officialHandle ?? 'naoeumfa';
  const [demoHandle, setDemoHandle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const demo = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    try {
      onDemoLink((await api.devAuthLink(demoHandle)).token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não rolou gerar o link.');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="glass modal modal--connect" role="dialog" aria-modal="true" aria-label="Entrar com Instagram" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <div>
            <span className="eyebrow">Teu perfil</span>
            <h2 className="title-md">Entra pelo Direct</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>

        <div className="connect">
          <ol className="connect__steps">
            <li>
              <span className="caption">1 · Manda “entrar” no Direct do @{official}</span>
              <a className="button button--primary" href={login?.directUrl ?? `https://ig.me/m/${official}`} target="_blank" rel="noreferrer noopener">
                Abrir Direct do @{official}
              </a>
            </li>
            <li>
              <span className="caption">2 · A gente te responde lá com um link</span>
              <p className="caption">Vale 10 minutos e uma vez só. Toca nele e você entra como a tua @.</p>
            </li>
          </ol>
          <p className="notice">
            Só você lê o teu Direct, então só você recebe esse link. Não tem senha nossa e digitar um @ aqui não dá acesso a nada.
            Nunca repassa o link pra ninguém.
          </p>
          {login && !login.ready && (
            <p className="notice notice--warning">O login pelo Direct liga assim que a Meta aprovar nosso app. Por enquanto a cidade é só pra ver.</p>
          )}
          {login?.canSimulate && (
            <form className="connect" onSubmit={(e) => void demo(e)}>
              <label className="field">
                <span className="caption">Demo: entrar como</span>
                <input
                  className="field__input"
                  value={demoHandle}
                  onChange={(e) => setDemoHandle(e.target.value)}
                  placeholder="@seu_usuario"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={31}
                  required
                />
              </label>
              <button type="submit" className="button button--ghost">
                Gerar link de demo
              </button>
            </form>
          )}
          {error && <p className="notice notice--danger">{error}</p>}
        </div>
      </section>
    </div>
  );
};
