/**
 * Login by Direct (A10). A fan writes "entrar" to the official account; Meta
 * delivers the message (signed webhook) with the sender's account id; we ask
 * Meta for that account's current @ and reply in the same inbox with a
 * one-time link. Nothing the fan types decides who they are.
 */

import { normalizeInstagramHandle } from '../../core/antiFraud.js';
import { logger } from '../../utils/logger.js';
import { InstagramDirectMessage } from '../instagram/metaWebhook.js';
import { AuthService, LOGIN_LINK_TTL_MS } from './authService.js';
import { IdentityRegistry } from './identityRegistry.js';

const LOGIN_WORDS = /\b(entrar|entra|login|logar|acessar)\b/i;
const REQUESTS_PER_SENDER = 3;
const SENDER_WINDOW_MS = 10 * 60_000;
const REMEMBERED_MESSAGES = 1_000;
const REQUEST_TIMEOUT_MS = 15_000;

export type DmLoginOutcome = 'sent' | 'ignored' | 'duplicate' | 'rate_limited' | 'lookup_failed' | 'refused' | 'send_failed';

export interface DmLoginOptions {
  readonly graphBaseUrl: string;
  /** The official account (`me` resolves to the token's own account). */
  readonly igUserId: string;
  readonly accessToken: string;
  readonly tokenTransport: 'query' | 'header';
  /** Where the link opens, e.g. https://www.naoeumfa.com */
  readonly publicUrl: string;
  readonly auth: AuthService;
  readonly identities: IdentityRegistry;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class DmLoginService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly graphOrigin: string;
  private readonly hitsBySender = new Map<string, number[]>();
  /** Meta retries deliveries; one message must never mint two links. */
  private readonly seenMessages = new Set<string>();

  constructor(private readonly options: DmLoginOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.graphOrigin = new URL(options.graphBaseUrl).origin;
  }

  async onMessage(message: InstagramDirectMessage): Promise<DmLoginOutcome> {
    if (this.seenMessages.has(message.messageId)) {
      return 'duplicate';
    }
    this.remember(message.messageId);
    if (!LOGIN_WORDS.test(message.text.normalize('NFC'))) {
      return 'ignored';
    }
    if (!this.takeBudget(message.senderId)) {
      logger.warn('dm_login_rate_limited');
      return 'rate_limited';
    }

    const username = await this.lookupUsername(message.senderId);
    if (!username) {
      return 'lookup_failed';
    }
    const identity = this.options.identities.resolve(message.senderId, username);
    if (!identity.ok) {
      await this.reply(
        message.senderId,
        `O @${username} já pertenceu a outra conta do Instagram aqui no Não É Um Fã, então não dá pra entrar com ele. Se isso é engano, fala com a gente.`
      );
      return 'refused';
    }

    const token = this.options.auth.createLoginLink(identity.handle, message.senderId);
    const minutes = Math.round(LOGIN_LINK_TTL_MS / 60_000);
    const sent = await this.reply(
      message.senderId,
      `Teu link pra entrar no naoeumfa.com como @${identity.handle}:\n${this.options.publicUrl}/#entrar=${token}\n\nVale ${minutes} minutos e uma vez só. Não manda pra ninguém: quem abrir entra como você.`
    );
    return sent ? 'sent' : 'send_failed';
  }

  /** The sender's current @, as Meta reports it for this account id. */
  private async lookupUsername(senderId: string): Promise<string | null> {
    const url = new URL(`${this.options.graphBaseUrl}/${encodeURIComponent(senderId)}`);
    url.searchParams.set('fields', 'username');
    try {
      const response = await this.call(url, { method: 'GET' });
      const body: unknown = await response.json().catch(() => null);
      const raw = isRecord(body) && typeof body.username === 'string' ? body.username : null;
      const handle = raw ? normalizeInstagramHandle(raw) : null;
      if (!response.ok || !handle) {
        logger.warn('dm_login_lookup_failed', { status: response.status });
        return null;
      }
      return handle;
    } catch (err) {
      logger.warn('dm_login_lookup_failed', { message: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  private async reply(recipientId: string, text: string): Promise<boolean> {
    const url = new URL(`${this.options.graphBaseUrl}/${encodeURIComponent(this.options.igUserId)}/messages`);
    try {
      const response = await this.call(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
      });
      if (!response.ok) {
        logger.warn('dm_login_send_failed', { status: response.status });
        return false;
      }
      return true;
    } catch (err) {
      logger.warn('dm_login_send_failed', { message: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  /** Only the Graph origin is ever contacted; URLs carrying the token are never logged. */
  private call(url: URL, init: RequestInit): Promise<Response> {
    if (url.origin !== this.graphOrigin) {
      throw new Error(`Refusing to call outside ${this.graphOrigin}.`);
    }
    const headers = new Headers(init.headers);
    if (this.options.tokenTransport === 'header') {
      headers.set('Authorization', `Bearer ${this.options.accessToken}`);
    } else {
      url.searchParams.set('access_token', this.options.accessToken);
    }
    return this.fetchImpl(url.toString(), { ...init, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }

  private takeBudget(senderId: string): boolean {
    const nowMs = this.now();
    const hits = (this.hitsBySender.get(senderId) ?? []).filter((t) => nowMs - t < SENDER_WINDOW_MS);
    if (hits.length >= REQUESTS_PER_SENDER) {
      this.hitsBySender.set(senderId, hits);
      return false;
    }
    hits.push(nowMs);
    this.hitsBySender.set(senderId, hits);
    return true;
  }

  private remember(messageId: string): void {
    this.seenMessages.add(messageId);
    if (this.seenMessages.size > REMEMBERED_MESSAGES) {
      const oldest = this.seenMessages.values().next().value;
      if (oldest !== undefined) {
        this.seenMessages.delete(oldest);
      }
    }
  }
}
