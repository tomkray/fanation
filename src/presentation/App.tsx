/**
 * Não É Um Fã shell: the live 3D world (city and planet views) with the
 * Instagram comment feed, the rankings, the property card and the marketplace
 * on top.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdDto, AdsDto, PropertyDetailDto } from '../shared/apiContract.js';
import { api, avatarUrl } from './api/client.js';
import { AdvertiseModal } from './components/AdvertiseModal.js';
import { ConnectModal } from './components/ConnectModal.js';
import { LinkLoginModal } from './components/LinkLoginModal.js';
import { Avatar, AvatarsEnabled, InstagramVerified } from './components/Identity.js';
import { ProfileModal } from './components/ProfileModal.js';
import { TokenomicsModal } from './components/TokenomicsModal.js';
import { useSession } from './hooks/useSession.js';
import { BrandLockup } from './components/BrandLockup.js';
import { CinematicOverlay } from './components/CinematicOverlay.js';
import { HomeSearch } from './components/HomeSearch.js';
import { JoinCard } from './components/JoinCard.js';
import { Leaderboard } from './components/Leaderboard.js';
import { LiveFeed } from './components/LiveFeed.js';
import { MarketplaceModal } from './components/MarketplaceModal.js';
import { PropertyCard, PropertyRef } from './components/PropertyCard.js';
import { formatInteger } from './format.js';
import { useCityAmbient } from './hooks/useCityAmbient.js';
import { useWorld } from './hooks/useWorld.js';
import { IsometricCityEngine, WorldView } from './three/IsometricCityEngine.js';

declare global {
  interface Window {
    __naoeumfaCinematic?: {
      readonly ready: boolean;
      renderFrame: (tSeconds: number) => void;
      setShots: (shots: readonly unknown[]) => void;
    };
  }
}

type MobilePanel = 'league' | 'feed' | null;

const params = new URLSearchParams(window.location.search);
const CINEMATIC = params.get('cinematic') === '1';
const MANUAL_FRAMES = params.get('capture') === '1';
const FOCUS_PARAM = params.get('focus');
const OPEN_ON_PLANET = params.get('view') === 'planet';
const DEFAULT_MOMENTUM_WINDOW_SECONDS = 3_600;
const CINEMATIC_CHUNKS = 64;
const ADS_REFRESH_MS = 60_000;
const REORGANIZED_NOTICE_MS = 4_000;

/** A Direct login link lands as `#entrar=<token>`; the fragment never reaches a server log. */
function takeLoginToken(): string | null {
  const match = /^#entrar=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
  if (!match) {
    return null;
  }
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  return match[1];
}

export const App: React.FC = () => {
  const { config, summary, store, status, error } = useWorld({ live: !MANUAL_FRAMES });
  useCityAmbient(!CINEMATIC && !MANUAL_FRAMES);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<IsometricCityEngine | null>(null);
  const avatarsRef = useRef(false);
  const cinematicArmed = useRef(false);
  const openedRef = useRef(false);
  const [selection, setSelection] = useState<PropertyRef | null>(null);
  const [view, setView] = useState<WorldView>('city');
  const [market, setMarket] = useState<{ readonly focusListingId: string | null } | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [loginToken, setLoginToken] = useState<string | null>(() => (CINEMATIC ? null : takeLoginToken()));
  const [tokenomicsOpen, setTokenomicsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const session = useSession(summary?.version ?? 0);
  const instagramVerified = useMemo(
    () => new Set((summary?.instagramVerified ?? []).map((handle) => handle.toLowerCase())),
    [summary?.instagramVerified]
  );
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [ads, setAds] = useState<AdsDto | null>(null);
  const adsRef = useRef<AdsDto | null>(null);
  const [advertise, setAdvertise] = useState<{ readonly tapped: AdDto | null } | null>(null);
  const [reorganized, setReorganized] = useState(false);
  avatarsRef.current = config?.avatars ?? false;
  adsRef.current = ads;

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      api
        .ads()
        .then((next) => {
          if (!cancelled) {
            setAds(next);
          }
        })
        .catch((err: unknown) => console.warn('[naoeumfa] ads unavailable; the sky stays empty', err));
    };
    load();
    const id = window.setInterval(load, ADS_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (ads) {
      engineRef.current?.setAds(ads.campaigns);
    }
  }, [ads]);

  useEffect(() => {
    if (!reorganized) {
      return undefined;
    }
    const id = window.setTimeout(() => setReorganized(false), REORGANIZED_NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [reorganized]);

  useEffect(() => {
    if (!viewportRef.current) {
      return undefined;
    }
    const engine = new IsometricCityEngine({
      container: viewportRef.current,
      modelBaseUrl: '/assets/models/',
      dracoDecoderUrl: '/draco/',
      preserveDrawingBuffer: CINEMATIC,
      avatarUrl: (handle) => avatarUrl(handle),
      onSelectProperty: (plotIndex) => setSelection({ kind: 'plot', plotIndex }),
      onVisibleChunks: (keys) => {
        if (!CINEMATIC) {
          store.show(keys).catch((err: unknown) => console.warn('[naoeumfa] chunk load failed; retrying on the next update', err));
        }
      },
      onViewChange: setView,
      onSelectAd: (adId) => setAdvertise({ tapped: adsRef.current?.campaigns.find((a) => a.id === adId) ?? null }),
    });
    const unsubscribe = store.subscribe((properties, mode) => {
      engine.upsertProperties(properties, mode);
      if (mode === 'reset') {
        setReorganized(true);
      }
    });
    engineRef.current = engine;
    if (adsRef.current) {
      engine.setAds(adsRef.current.campaigns);
    }
    if (!CINEMATIC) {
      engine.start();
    }
    return () => {
      unsubscribe();
      engine.dispose();
      engineRef.current = null;
      delete window.__naoeumfaCinematic;
    };
  }, [store]);

  useEffect(() => {
    const engine = engineRef.current;
    // Labels need to know whether profile pictures exist before they are first drawn.
    if (!engine || !summary || !config) {
      return;
    }
    const firstWorld = !openedRef.current;
    openedRef.current = true;
    engine.setWorld(summary);
    if (firstWorld && OPEN_ON_PLANET && !CINEMATIC) {
      engine.setView('planet');
    }
    if (!CINEMATIC || cinematicArmed.current) {
      return;
    }
    cinematicArmed.current = true;
    const focus = FOCUS_PARAM ?? summary.standings[0]?.fandomHandle ?? null;
    const anchor = summary.standings.find((s) => s.fandomHandle === focus);
    const fx = anchor?.districtX ?? 0;
    const fz = anchor?.districtZ ?? 0;
    const keys = [...summary.chunks]
      .sort((a, b) => Math.hypot(a.x - fx, a.z - fz) - Math.hypot(b.x - fx, b.z - fz))
      .slice(0, CINEMATIC_CHUNKS)
      .map((c) => c.key);
    void Promise.all([engine.ready, store.show(keys)])
      .then(() => {
        if (engineRef.current !== engine) {
          return;
        }
        engine.enableCinematic(focus, MANUAL_FRAMES);
        window.__naoeumfaCinematic = {
          ready: true,
          renderFrame: (t) => engine.renderCinematicFrame(t),
          setShots: (shots) => engine.setCinematicShots(shots),
        };
      })
      .catch((err: unknown) => console.error('[naoeumfa] cinematic setup failed', err));
  }, [summary, config, store]);

  const focusHandle = (handle: string): void => {
    setSelection({ kind: 'handle', handle });
    setMobilePanel(null);
    if (engineRef.current?.focusHandle(handle)) {
      return;
    }
    api
      .profile(handle)
      .then((d) => engineRef.current?.focusPoint(d.x, d.z))
      .catch(() => undefined); // Not in the city yet: the card says so.
  };
  const highlightDetail = useCallback((detail: PropertyDetailDto | null) => engineRef.current?.highlight(detail), []);
  const portraitOf = useCallback(
    (detail: PropertyDetailDto): Promise<string | null> => engineRef.current?.portrait(detail) ?? Promise.resolve(null),
    []
  );
  const closeSelection = useCallback(() => {
    setSelection(null);
    engineRef.current?.highlight(null);
  }, []);

  const showHome = (detail: PropertyDetailDto): void => {
    setMobilePanel(null);
    setView('city');
    const key = engineRef.current?.focusHome(detail);
    if (key) {
      // The fly takes under a second; the chunk has to be in memory when it lands.
      void store.show([key]).catch((err: unknown) => console.warn('[naoeumfa] home chunk failed', err));
    }
    // The ring and the status line are the answer. The deed opens when the house itself is tapped.
    setSelection(null);
  };

  const focusPlot = (plotIndex: number): void => {
    setSelection({ kind: 'plot', plotIndex });
    setMobilePanel(null);
    api
      .property(plotIndex)
      .then((d) => engineRef.current?.focusPoint(d.x, d.z))
      .catch((err: unknown) => console.warn('[naoeumfa] property lookup failed', err));
  };

  if (CINEMATIC) {
    return (
      <AvatarsEnabled.Provider value={config?.avatars ?? false}>
        <InstagramVerified.Provider value={instagramVerified}>
        <div className="app app--cinematic">
          <div ref={viewportRef} className="viewport" />
          {summary && <CinematicOverlay world={summary} capture={MANUAL_FRAMES} />}
        </div>
        </InstagramVerified.Provider>
      </AvatarsEnabled.Provider>
    );
  }

  const league = summary ? (
    <Leaderboard
      standings={summary.standings}
      rankChanges={summary.rankChanges}
      topByXp={summary.topByXp}
      topByTokens={summary.topByTokens}
      momentumWindowSeconds={config?.momentumWindowSeconds ?? DEFAULT_MOMENTUM_WINDOW_SECONDS}
      onFocusHandle={focusHandle}
    />
  ) : null;
  const feed = summary ? (
    <LiveFeed
      entries={summary.activity}
      pollIntervalSeconds={config && config.commentSource !== 'off' ? config.pollIntervalSeconds : null}
      onFocusLand={focusPlot}
      onAdvertise={() => setAdvertise({ tapped: null })}
    />
  ) : null;

  const viewer = session.me?.handle ?? null;
  const openWallet = (): void => (viewer ? setProfileOpen(true) : setConnectOpen(true));
  const deed =
    selection && summary ? (
      <PropertyCard
        target={selection}
        version={summary.version}
        cities={summary.cities}
        viewer={viewer}
        onFocusHandle={focusHandle}
        onDetail={highlightDetail}
        onBuy={(listingId) => setMarket({ focusListingId: listingId })}
        onConnect={() => setConnectOpen(true)}
        onChanged={session.refresh}
        onClose={closeSelection}
        portrait={portraitOf}
      />
    ) : null;

  return (
    <AvatarsEnabled.Provider value={config?.avatars ?? false}>
      <InstagramVerified.Provider value={instagramVerified}>
      <div className="app">
        <div ref={viewportRef} className="viewport" aria-label="Mundo 3D Não É Um Fã" />

        <nav className="glass topbar">
          <BrandLockup />
          <span className={`live-pill live-pill--${status}`} role="status" aria-label={status === 'live' ? 'Ao vivo' : status === 'connecting' ? 'Conectando…' : 'Reconectando…'}>
            <span className="live-dot" />
            <span className="live-pill__label">{status === 'live' ? 'Ao vivo' : status === 'connecting' ? 'Conectando…' : 'Reconectando…'}</span>
            {config?.demo && <span className="live-pill__demo">DEMO</span>}
          </span>
          <span className="topbar__stats">
            <span>
              <strong>{formatInteger(summary?.totals.properties ?? 0)}</strong> casas
            </span>
            <span>
              <strong>{formatInteger(summary?.totals.idols ?? 0)}</strong> ídolos
            </span>
            <span>
              <strong>{formatInteger(summary?.totals.commentsProcessed ?? 0)}</strong> comentários
            </span>
          </span>
          <button
            type="button"
            className="button topbar__view"
            aria-pressed={view === 'planet'}
            onClick={() => engineRef.current?.setView(view === 'planet' ? 'city' : 'planet')}
          >
            {view === 'planet' ? 'Cidade' : 'Planeta'}
          </button>
          <button type="button" className="button topbar__view" onClick={() => setTokenomicsOpen(true)}>
            $NEFA
          </button>
          <button type="button" className="button topbar__view" onClick={() => setAdvertise({ tapped: null })}>
            Anunciar
          </button>
          <button type="button" className="button topbar__view" onClick={() => setMarket({ focusListingId: null })}>
            Mercado
          </button>
          {session.me ? (
            <button type="button" className="topbar__me" onClick={() => setProfileOpen(true)} aria-label={`Seu perfil @${session.me.handle}`}>
              <Avatar handle={session.me.handle} size="sm" />
              <span>@{session.me.handle}</span>
              <span className="level-badge">Nv {session.me.level}</span>
            </button>
          ) : (
            <button type="button" className="button button--primary topbar__market" onClick={() => setConnectOpen(true)}>
              Entrar
            </button>
          )}
        </nav>

        <HomeSearch onFound={showHome} />

        {error && <p className="glass notice notice--danger toast">{error}</p>}
        {reorganized && !error && (
          <p className="glass notice toast" role="status">
            A cidade acabou de se reorganizar em volta dos ídolos ✨
          </p>
        )}

        {/* The ranking owns the whole left column; a selected property opens as a movable deed. */}
        <aside className="hud hud--left">{league}</aside>
        <aside className="hud hud--right">{feed}</aside>
        {!deed && (
          <div className="hud hud--bottom">
            <JoinCard onAdvertise={() => setAdvertise({ tapped: null })} />
          </div>
        )}
        {deed}

        {mobilePanel !== null && <div className="sheet">{mobilePanel === 'league' ? league : feed}</div>}
        <nav className="glass tabbar" aria-label="Painéis">
          <button type="button" aria-pressed={mobilePanel === 'league'} onClick={() => setMobilePanel(mobilePanel === 'league' ? null : 'league')}>
            Ranking
          </button>
          <button type="button" aria-pressed={mobilePanel === 'feed'} onClick={() => setMobilePanel(mobilePanel === 'feed' ? null : 'feed')}>
            Ao vivo
          </button>
          <button type="button" aria-pressed={view === 'planet'} onClick={() => engineRef.current?.setView(view === 'planet' ? 'city' : 'planet')}>
            {view === 'planet' ? 'Cidade' : 'Planeta'}
          </button>
          <button type="button" onClick={openWallet}>
            {viewer ? 'Carteira' : 'Entrar'}
          </button>
        </nav>

        {market && summary && config && (
          <MarketplaceModal
            listings={summary.listings}
            config={config}
            buyerHandle={viewer}
            focusListingId={market.focusListingId}
            onConnect={() => {
              setMarket(null);
              setConnectOpen(true);
            }}
            onClose={() => setMarket(null)}
          />
        )}
        {tokenomicsOpen && summary && <TokenomicsModal tokenomics={summary.tokenomics} onClose={() => setTokenomicsOpen(false)} />}
        {connectOpen && (
          <ConnectModal
            login={config?.login ?? null}
            onDemoLink={(token) => {
              setConnectOpen(false);
              setLoginToken(token);
            }}
            onClose={() => setConnectOpen(false)}
          />
        )}
        {loginToken && (
          <LinkLoginModal
            token={loginToken}
            onConnected={() => {
              setLoginToken(null);
              session.refresh();
              setProfileOpen(true);
            }}
            onClose={() => setLoginToken(null)}
          />
        )}
        {profileOpen && session.me && (
          <ProfileModal
            me={session.me}
            onChanged={session.refresh}
            onShowProperty={(plotIndex) => {
              setProfileOpen(false);
              focusPlot(plotIndex);
            }}
            onBuyListing={(listingId) => {
              setProfileOpen(false);
              setMarket({ focusListingId: listingId });
            }}
            onLogout={() => {
              setProfileOpen(false);
              void session.logout();
            }}
            onClose={() => setProfileOpen(false)}
          />
        )}
        {advertise && (
          <AdvertiseModal ads={ads} tapped={advertise.tapped} cities={summary?.cities ?? []} onClose={() => setAdvertise(null)} />
        )}
      </div>
      </InstagramVerified.Provider>
    </AvatarsEnabled.Provider>
  );
};
