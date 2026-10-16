import React, { useState } from 'react';
import { normalizeInstagramHandle } from '../../core/antiFraud.js';
import type { PropertyDetailDto } from '../../shared/apiContract.js';
import { api, ApiError } from '../api/client.js';
import { homeNumber } from '../format.js';

/** The map's front door: type an @, and the camera flies to that house. */
export const HomeSearch: React.FC<{ readonly onFound: (detail: PropertyDetailDto) => void }> = ({ onFound }) => {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'searching' | 'found' | 'missing' | 'invalid'>('idle');
  const [missingHandle, setMissingHandle] = useState('');
  const [foundLine, setFoundLine] = useState('');

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
        const beside = detail.idolHandle ? `next to @${detail.idolHandle}` : 'your district';
        setFoundLine(`Here it is. @${detail.minterHandle} · Home ${homeNumber(detail.plotIndex)} · ${beside}`);
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
    <form className="home-search glass" role="search" onSubmit={submit}>
      <label className="home-search__label" htmlFor="home-search">
        Find your house
      </label>
      <div className="home-search__row">
        <input
          id="home-search"
          className="field__input"
          placeholder="@yourname"
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
          {status === 'searching' ? 'Looking…' : 'Show'}
        </button>
      </div>
      {status === 'found' && (
        <p id="home-search-note" className="home-search__note home-search__note--found" role="status">
          {foundLine}
        </p>
      )}
      {status === 'missing' && (
        <p id="home-search-note" className="home-search__note" role="status">
          @{missingHandle} has no house yet. Comment an idol&apos;s @ on a @fanation.club post.
        </p>
      )}
      {status === 'invalid' && (
        <p id="home-search-note" className="home-search__note" role="status">
          Use an Instagram @, like @yourname.
        </p>
      )}
    </form>
  );
};
