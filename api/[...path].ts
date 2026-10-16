/**
 * Proxies /api/* from the Vercel site to the city process on this Mac (Tailscale Funnel).
 * External rewrites hit DNS_HOSTNAME_EMPTY against *.ts.net; Edge fetch resolves it.
 */

export const config = { runtime: 'edge' };

const CITY_ORIGIN = 'https://toms-macbook-pro.tail3998b5.ts.net';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

export default async function handler(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, CITY_ORIGIN);
  if (target.origin !== CITY_ORIGIN) {
    return new Response('Bad gateway target.', { status: 502 });
  }

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    // Required when forwarding a stream body from Edge.
    (init as RequestInit & { duplex?: string }).duplex = 'half';
  }

  try {
    const upstream = await fetch(target, init);
    const out = new Headers();
    upstream.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) {
        out.set(key, value);
      }
    });
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upstream failed';
    return new Response(JSON.stringify({ error: message, code: 'CITY_UNREACHABLE' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
