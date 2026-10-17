import React, { useEffect, useRef, useState } from 'react';
import { normalizeInstagramHandle } from '../../core/antiFraud.js';
import type { PropertyDetailDto } from '../../shared/apiContract.js';
import { api, ApiError } from '../api/client.js';
import { homeNumber } from '../format.js';

/** Finds a home. Docked under the top bar so the city stays in view. */
export const HomeSearch: React.FC<{ readonly onFound: (detail: PropertyDetailDto) => void }> = ({ onFound }) => {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'searching' | 'found' | 'missing' | 'invalid'>('idle');
  const [missingHandle, setMissingHandle] = useState('');
  const [foundLine, setFoundLine] = useState('');
  const [hot, setHot] = useState(false);
  const node = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const close = (event: PointerEvent): void => {
      const target = event.target;
      if (status !== 'idle') {
        return;
      }
      if (target instanceof Node && node.current?.contains(target)) {
        return;
      }
      setHot(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [status]);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const handle = normalizeInstagramHandle(query);
    if (!handle) {
      setStatus('invalid');
      return;
    }
    setStatus('searching');
    api
      .profile(handle)
      .then((detail) => {
        const beside = detail.idolHandle ? `do lado de @${detail.idolHandle}` : 'no seu distrito';
        setFoundLine(`@${detail.minterHandle} · Casa ${homeNumber(detail.plotIndex)} · ${beside}`);
        setStatus('found');
        setQuery(`@${detail.minterHandle}`);
        onFound(detail);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          setMissingHandle(handle);
          setStatus('missing');
          return;
        }
        setStatus('invalid');
      });
  };

  return (
    <form
      ref={node}
      className={`home-search glass${hot || status !== 'idle' ? ' home-search--open' : ''}`}
      role="search"
      onSubmit={submit}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') {
          setHot(true);
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse' || status !== 'idle') {
          return;
        }
        const active = document.activeElement;
        if (active instanceof Node && node.current?.contains(active)) {
          return;
        }
        setHot(false);
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== 'mouse') {
          setHot(true);
        }
      }}
    >
      <label className="home-search__label" htmlFor="home-search">
        Acha tua casa
      </label>
      <div className="home-search__row">
        <input
          id="home-search"
          className="field__input"
          placeholder="@seunome"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={31}
          value={query}
          aria-describedby={status === 'idle' || status === 'searching' ? undefined : 'home-search-note'}
          onChange={(e) => {
            setQuery(e.target.value);
            if (status !== 'searching') {
              setStatus('idle');
            }
          }}
        />
        <button type="submit" className="button button--primary" disabled={status === 'searching'}>
          {status === 'searching' ? '…' : 'Ir'}
        </button>
      </div>
      {status === 'found' && (
        <p id="home-search-note" className="home-search__note home-search__note--found" role="status">
          {foundLine}
        </p>
      )}
      {status === 'missing' && (
        <p id="home-search-note" className="home-search__note" role="status">
          @{missingHandle} ainda não tem casa.
        </p>
      )}
      {status === 'invalid' && (
        <p id="home-search-note" className="home-search__note" role="status">
          Usa um @, tipo @seunome.
        </p>
      )}
    </form>
  );
};
