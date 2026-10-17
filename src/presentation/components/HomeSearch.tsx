import React, { useEffect, useRef, useState } from 'react';
import { normalizeInstagramHandle } from '../../core/antiFraud.js';
import type { PropertyDetailDto } from '../../shared/apiContract.js';
import { api, ApiError } from '../api/client.js';
import { homeNumber } from '../format.js';

const POS_KEY = 'naoeumfa.homeSearch';

/** Quiet map search: invisible until the pointer is over it, and draggable. */
export const HomeSearch: React.FC<{ readonly onFound: (detail: PropertyDetailDto) => void }> = ({ onFound }) => {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'searching' | 'found' | 'missing' | 'invalid'>('idle');
  const [missingHandle, setMissingHandle] = useState('');
  const [foundLine, setFoundLine] = useState('');
  const [pos, setPos] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const drag = useRef<{ readonly dx: number; readonly dy: number } | null>(null);
  const node = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(POS_KEY);
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && 'x' in parsed && 'y' in parsed) {
          const x = Number((parsed as { x: unknown }).x);
          const y = Number((parsed as { y: unknown }).y);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            setPos({ x, y });
            return;
          }
        }
      } catch {
        // A bad saved position just falls back to the default dock.
      }
    }
    setPos({
      x: Math.max(8, Math.round(window.innerWidth / 2 - 200)),
      y: Math.max(72, window.innerHeight - 200),
    });
  }, []);

  useEffect(() => {
    if (pos) {
      sessionStorage.setItem(POS_KEY, JSON.stringify(pos));
    }
  }, [pos]);

  const liftIntoView = (): void => {
    const rect = node.current?.getBoundingClientRect();
    if (!rect || !pos) {
      return;
    }
    const needed = 176;
    if (rect.top + needed > window.innerHeight - 8) {
      setPos({ x: pos.x, y: Math.max(8, window.innerHeight - needed - 8) });
    }
  };

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

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const rect = node.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    drag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (!drag.current) {
      return;
    }
    const height = node.current?.offsetHeight ?? 44;
    setPos({
      x: Math.min(window.innerWidth - 44, Math.max(8, event.clientX - drag.current.dx)),
      y: Math.min(window.innerHeight - Math.min(height, 44), Math.max(8, event.clientY - drag.current.dy)),
    });
  };
  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>): void => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <form
      ref={node}
      className={`home-search glass${status === 'idle' ? '' : ' home-search--open'}`}
      role="search"
      style={pos ? { left: pos.x, top: pos.y } : { visibility: 'hidden' }}
      onMouseEnter={liftIntoView}
      onFocus={liftIntoView}
      onSubmit={submit}
    >
      <button
        type="button"
        className="home-search__grip"
        aria-label="Busca. Arraste para mover."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        ⌕
      </button>
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
