/**
 * First contact with the official account: proves the token works, reads the
 * latest @naoeumfa posts and shows what the city WOULD do with each real
 * comment. Runs the real rules on an in-memory city; nothing is written.
 *
 *   npm run instagram:check
 */

import { existsSync } from 'node:fs';
import { applyCommentEvent, createCityState, DEFAULT_LEDGER_CONFIG } from '../src/core/cityLedger.js';
import { CommentRejectionCode } from '../src/core/types.js';
import { DEFAULT_GRAPH_BASE_URL, OFFICIAL_INSTAGRAM_HANDLE } from '../src/infrastructure/config.js';
import { GraphCommentSource } from '../src/infrastructure/instagram/graphCommentSource.js';

const REJECTION_LABEL: Record<CommentRejectionCode, string> = {
  DUPLICATE_COMMENT_ID: 'already read',
  OWN_ACCOUNT_COMMENT: `posted by @${OFFICIAL_INSTAGRAM_HANDLE} itself`,
  RATE_LIMIT_EXCEEDED: 'too fast',
  INVALID_COMMENT_FORMAT: 'off-format',
  SELF_MINT_FORBIDDEN: 'self-fandom',
  POST_ALREADY_COUNTED: 'already scored on this post',
};

function howToGetToken(): void {
  console.log(`
No Instagram token yet. One-time setup:

  1. Instagram app, @${OFFICIAL_INSTAGRAM_HANDLE}: Settings → Account type → switch to a Professional account.
  2. developers.facebook.com → My Apps → Create app → add the "Instagram" product
     → "API setup with Instagram login".
  3. Under "Generate access tokens", add @${OFFICIAL_INSTAGRAM_HANDLE} and accept
     instagram_business_basic and instagram_business_manage_comments.
  4. Paste the token into the .env file in this folder:
       FANATION_IG_ACCESS_TOKEN=paste_here
     (never paste the token in a chat or anywhere but .env)
  5. Run again: npm run instagram:check
`);
}

async function main(): Promise<number> {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const token = process.env.FANATION_IG_ACCESS_TOKEN?.trim();
  if (!token) {
    howToGetToken();
    return 1;
  }
  const base = process.env.FANATION_GRAPH_BASE_URL?.trim() || DEFAULT_GRAPH_BASE_URL;
  const transport = process.env.FANATION_GRAPH_TOKEN_TRANSPORT === 'header' ? 'header' : 'query';
  const userId = process.env.FANATION_IG_USER_ID?.trim() || 'me';

  const meUrl = new URL(`${base}/${encodeURIComponent(userId)}`);
  meUrl.searchParams.set('fields', 'id,username');
  if (transport === 'query') {
    meUrl.searchParams.set('access_token', token);
  }
  const meResponse = await fetch(meUrl, {
    headers: transport === 'header' ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  const me = (await meResponse.json().catch(() => null)) as { username?: string; error?: { message?: string } } | null;
  if (!meResponse.ok || !me?.username) {
    console.error(`✗ Instagram rejected the token (HTTP ${meResponse.status}): ${me?.error?.message ?? 'unexpected response'}`);
    return 1;
  }
  console.log(`✓ Token is valid for @${me.username}`);
  if (me.username.toLowerCase() !== OFFICIAL_INSTAGRAM_HANDLE) {
    console.warn(`! Heads up: the official account is @${OFFICIAL_INSTAGRAM_HANDLE}, but this token belongs to @${me.username}.`);
  }

  const source = new GraphCommentSource({
    graphBaseUrl: base,
    igUserId: userId,
    accessToken: token,
    mediaLimit: Number.parseInt(process.env.FANATION_POLL_MEDIA_LIMIT ?? '10', 10) || 10,
    tokenTransport: transport,
  });
  const events = (await source.fetchComments()).sort((a, b) => a.receivedAtMs - b.receivedAtMs);
  console.log(`✓ Read ${events.length} comments on the latest posts\n`);

  const city = createCityState({ ...DEFAULT_LEDGER_CONFIG, officialAccountHandle: me.username.toLowerCase() });
  const tally = { minted: 0, points: 0, ignored: 0 };
  for (const event of events) {
    const outcome = applyCommentEvent(city, event);
    const head = `@${event.authorUsername}: "${event.text.slice(0, 70)}"`;
    switch (outcome.status) {
      case 'MINTED_NEW_LAND':
        tally.minted += 1;
        console.log(`  🏠 ${head}\n     → home #${outcome.land.plotIndex} next to @${outcome.idol.minterHandle} (fan #${outcome.idolFans})`);
        break;
      case 'ENGAGEMENT_POINTS_ONLY':
        tally.points += 1;
        console.log(
          `  ➕ ${head}\n     → +${outcome.xpGained} XP${outcome.newFan ? ` · now fan #${outcome.idolFans} of @${outcome.idol.minterHandle}` : ''}`
        );
        break;
      case 'REJECTED':
        tally.ignored += 1;
        console.log(`  ·  ${head}\n     → ignored: ${REJECTION_LABEL[outcome.code]}`);
        break;
      default: {
        const exhaustive: never = outcome;
        throw new Error(`Unknown outcome ${JSON.stringify(exhaustive)}`);
      }
    }
  }
  console.log(
    `\nSummary: ${tally.minted} lands, ${tally.points} point awards, ${tally.ignored} ignored.` +
      '\nNothing was written. To go live: npm run dev:live'
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
