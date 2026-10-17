/**
 * Boot: config → replay journal → start the comment collector → listen.
 */

import { existsSync } from 'node:fs';
import { logger } from '../../utils/logger.js';
import { CityService } from '../cityService.js';
import { loadConfig } from '../config.js';
import { maybeCreateDemoListings } from '../demo/demoMarketMaker.js';
import { AdService } from '../ads/adService.js';
import { AuthService } from '../auth/authService.js';
import { DmLoginService } from '../auth/dmLogin.js';
import { IdentityRegistry } from '../auth/identityRegistry.js';
import { AvatarService } from '../instagram/avatarService.js';
import { CommentPoller } from '../instagram/commentPoller.js';
import { CommentSource } from '../instagram/commentSource.js';
import { GraphCommentSource } from '../instagram/graphCommentSource.js';
import { SimulatedCommentSource } from '../instagram/simulatedCommentSource.js';
import { FileEventJournal } from '../persistence/eventJournal.js';
import { createNaoeumfaServer } from './server.js';

/** Real pictures for the head of the ranking, refreshed hourly (stale after 24 h). */
const AVATAR_WARM_TOP_N = 60;
const AVATAR_WARM_INTERVAL_MS = 3_600_000;

function main(): void {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const config = loadConfig();
  if (config.demo) {
    logger.warn('demo_mode_enabled', { note: 'Simulated comments allowed, demo PIX key; unset secrets are random per boot.' });
  }

  const city = new CityService(
    {
      officialAccountHandle: config.meta.officialUsername,
      layoutEpochMs: config.layoutEpochSeconds * 1000,
      seasonLengthMs: config.seasonSeconds * 1000,
    },
    new FileEventJournal(config.journalPath),
    (err) => {
      logger.error('journal_write_failed_halting', { message: err.message });
      process.exit(1);
    },
    config.momentumWindowSeconds * 1000,
    config.liveFromMs
  );
  city.boot();
  if (config.commentSource === 'instagram' && city.journalSources.has('simulated')) {
    throw new Error(
      `Journal ${config.journalPath} contains simulated fans. The real city needs its own book: ` +
        'set NAOEUMFA_JOURNAL_PATH to a new file (default data/ledger.jsonl).'
    );
  }

  const avatars = new AvatarService(config.avatars);

  let source: CommentSource | null = null;
  if (config.commentSource === 'instagram' && config.meta.igAccessToken && config.meta.igUserId) {
    source = new GraphCommentSource({
      graphBaseUrl: config.meta.graphBaseUrl,
      igUserId: config.meta.igUserId,
      accessToken: config.meta.igAccessToken,
      mediaLimit: config.pollMediaLimit,
      tokenTransport: config.meta.tokenTransport,
    });
  } else if (config.commentSource === 'simulated') {
    source = new SimulatedCommentSource({ seed: Date.now() % 2_147_483_647 });
  } else {
    logger.info('comment_poller_disabled', { commentSource: config.commentSource });
  }

  const poller = source
    ? new CommentPoller(source, config.pollIntervalSeconds * 1000, (events, sourceName) => {
        const outcomes = city.ingestComments(events, sourceName);
        const portraits: string[] = [];
        for (const outcome of outcomes) {
          if (outcome.status === 'REJECTED') {
            continue;
          }
          portraits.push(outcome.land.minterHandle, outcome.idol.minterHandle, outcome.land.ownerHandle);
        }
        avatars.enqueue(portraits);
        if (config.sandbox) {
          maybeCreateDemoListings(city, Date.now());
        }
      })
    : null;

  const warmAvatars = (): void => {
    void avatars.warm(city.topIdolHandles(AVATAR_WARM_TOP_N));
  };
  // Same warm loop whether Discovery or public-page interim — one pipeline.
  const avatarTimer = setInterval(warmAvatars, AVATAR_WARM_INTERVAL_MS);
  if (avatars.discoveryEnabled) {
    logger.info('avatars_discovery', { note: 'Business Discovery token set; Graph lookup preferred.' });
  } else {
    logger.info('avatars_interim', {
      note: 'No Discovery token; public-page og:image until NAOEUMFA_DISCOVERY_* is set. Same enqueue after every mint.',
    });
  }

  const ads = new AdService(config.adsPath, config.sandbox);
  // Demo sessions and identities never share files with the real city, like the journal.
  const book = config.commentSource === 'simulated' ? '.demo' : '';
  const auth = new AuthService(`data/sessions${book}.json`);
  const identities = new IdentityRegistry(`data/identities${book}.json`);
  const dmLogin =
    config.meta.igAccessToken && config.meta.igUserId
      ? new DmLoginService({
          graphBaseUrl: config.meta.graphBaseUrl,
          igUserId: config.meta.igUserId,
          accessToken: config.meta.igAccessToken,
          tokenTransport: config.meta.tokenTransport,
          publicUrl: config.publicUrl,
          auth,
          identities,
        })
      : null;
  logger.info(dmLogin ? 'dm_login_on' : 'dm_login_off', { publicUrl: config.publicUrl });
  const server = createNaoeumfaServer(config, { city, avatars, ads, auth, dmLogin });
  server.listen(config.port, config.host, () => {
    logger.info('api_listening', { url: `http://${config.host}:${config.port}`, commentSource: config.commentSource });
    poller?.start();
    warmAvatars();
  });

  const shutdown = (signal: string) => {
    logger.info('api_shutdown', { signal });
    poller?.stop();
    if (avatarTimer) {
      clearInterval(avatarTimer);
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

try {
  main();
} catch (err) {
  logger.error('api_boot_failed', { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
}
