/**
 * Login by Direct (A10): only a message Meta delivered decides who signs in;
 * the link goes back to that same inbox; an @ that changed hands is refused.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuthService } from '../src/infrastructure/auth/authService.js';
import { DmLoginService } from '../src/infrastructure/auth/dmLogin.js';
import { IdentityRegistry } from '../src/infrastructure/auth/identityRegistry.js';
import { InstagramDirectMessage, parseMetaMessageWebhook } from '../src/infrastructure/instagram/metaWebhook.js';

function dir(): string {
  return mkdtempSync(path.join(tmpdir(), 'naoeumfa-dm-'));
}

interface Sent {
  readonly to: string;
  readonly text: string;
}

/** A fake Graph API: account id → current @, and every reply captured. */
function harness(usernames: Record<string, string>) {
  const root = dir();
  const auth = new AuthService(path.join(root, 'sessions.json'));
  const identities = new IdentityRegistry(path.join(root, 'identities.json'));
  const sent: Sent[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { recipient: { id: string }; message: { text: string } };
      sent.push({ to: body.recipient.id, text: body.message.text });
      return new Response('{}', { status: 200 });
    }
    const id = url.pathname.split('/').pop() ?? '';
    const username = usernames[id];
    return username ? new Response(JSON.stringify({ id, username }), { status: 200 }) : new Response('{}', { status: 404 });
  }) as typeof fetch;
  const dm = new DmLoginService({
    graphBaseUrl: 'https://graph.instagram.com/v23.0',
    igUserId: 'me',
    officialHandle: 'naoeumfa',
    accessToken: 'test-token',
    tokenTransport: 'header',
    publicUrl: 'https://www.naoeumfa.com',
    auth,
    identities,
    fetchImpl,
  });
  return { auth, identities, dm, sent, usernames };
}

function message(senderId: string, text: string, messageId: string): InstagramDirectMessage {
  return { senderId, text, messageId, atMs: 1 };
}

function tokenIn(text: string): string {
  const match = /#entrar=([A-Za-z0-9_-]{43})/.exec(text);
  if (!match) {
    throw new Error(`no link in: ${text}`);
  }
  return match[1];
}

describe('Direct webhook parsing', () => {
  it('keeps inbound text messages and drops our own echoes', () => {
    const parsed = parseMetaMessageWebhook({
      object: 'instagram',
      entry: [
        {
          id: 'OWN',
          time: 1,
          messaging: [
            { sender: { id: 'FAN1' }, recipient: { id: 'OWN' }, timestamp: 5, message: { mid: 'm1', text: 'entrar' } },
            { sender: { id: 'OWN' }, recipient: { id: 'FAN1' }, timestamp: 6, message: { mid: 'm2', text: 'link', is_echo: true } },
            { sender: { id: 'OWN' }, recipient: { id: 'FAN1' }, timestamp: 7, message: { mid: 'm3', text: 'no echo flag' } },
            { sender: { id: 'FAN2' }, recipient: { id: 'OWN' }, timestamp: 8, message: { mid: 'm4' } },
          ],
        },
      ],
    });
    expect(parsed).toEqual([{ senderId: 'FAN1', messageId: 'm1', text: 'entrar', atMs: 5 }]);
  });
});

describe('login by Direct', () => {
  it('answers "entrar" in the sender\'s own inbox with a link for the @ Meta reports', async () => {
    const h = harness({ '17841400000000001': 'Alice.Fan' });
    expect(await h.dm.onMessage(message('17841400000000001', 'oi, quero ENTRAR', 'm1'))).toBe('sent');
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe('17841400000000001');
    expect(h.sent[0].text).toContain('@alice.fan');
    expect(h.auth.peekLoginLink(tokenIn(h.sent[0].text))).toBe('alice.fan');
  });

  it('ignores other messages, repeated deliveries and floods', async () => {
    const h = harness({ A: 'ana' });
    expect(await h.dm.onMessage(message('A', 'amei o reel', 'm1'))).toBe('ignored');
    expect(await h.dm.onMessage(message('A', 'entrar', 'm2'))).toBe('sent');
    expect(await h.dm.onMessage(message('A', 'entrar', 'm2'))).toBe('duplicate');
    expect(await h.dm.onMessage(message('A', 'entrar', 'm3'))).toBe('sent');
    expect(await h.dm.onMessage(message('A', 'entrar', 'm4'))).toBe('sent');
    expect(await h.dm.onMessage(message('A', 'entrar', 'm5'))).toBe('rate_limited');
    expect(h.sent).toHaveLength(3);
  });

  it('never signs in the official account', async () => {
    const h = harness({ OFFICIAL: 'NaoEumFa' });
    expect(await h.dm.onMessage(message('OFFICIAL', 'entrar', 'm1'))).toBe('refused');
    expect(h.sent).toHaveLength(0);
  });

  it('never trusts a sender Meta cannot name', async () => {
    const h = harness({});
    expect(await h.dm.onMessage(message('GHOST', 'entrar', 'm1'))).toBe('lookup_failed');
    expect(h.sent).toHaveLength(0);
  });

  it('refuses a recycled @ and keeps a renamed account on its own profile', async () => {
    const h = harness({ X: 'fulano', Y: 'outra_pessoa' });
    expect(await h.dm.onMessage(message('X', 'entrar', 'm1'))).toBe('sent');

    // X renames; Y takes the old @.
    h.usernames.X = 'fulano_novo';
    h.usernames.Y = 'fulano';
    expect(await h.dm.onMessage(message('Y', 'entrar', 'm2'))).toBe('refused');
    expect(h.sent[1].to).toBe('Y');
    expect(h.sent[1].text).not.toContain('#entrar=');

    expect(await h.dm.onMessage(message('X', 'entrar', 'm3'))).toBe('sent');
    expect(h.auth.peekLoginLink(tokenIn(h.sent[2].text))).toBe('fulano');
  });

  it('keeps the account binding across restarts', () => {
    const root = dir();
    const first = new IdentityRegistry(path.join(root, 'ids.json'));
    expect(first.resolve('X', 'fulano')).toEqual({ ok: true, handle: 'fulano', renamed: false });
    const again = new IdentityRegistry(path.join(root, 'ids.json'));
    expect(again.resolve('Y', 'fulano')).toEqual({ ok: false, reason: 'HANDLE_OWNED_BY_OTHER_ACCOUNT' });
  });
});
