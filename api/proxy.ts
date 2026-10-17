/**
 * Proxies /api/* from Vercel to the city on this Mac (Cloudflare Tunnel).
 * Tailscale Funnel hostnames fail DNS from Vercel Edge; trycloudflare.com does not.
 */

export const config = { runtime: 'edge' };

const CITY_ORIGIN = (typeof process !== 'undefined' && (process.env.NAOEUMFA_CITY_ORIGIN ?? process.env.FANATION_CITY_ORIGIN)?.trim()) || 'https://withdrawal-wine-existence-assistant.trycloudflare.com';

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
  const suffix = incoming.searchParams.get('path') ?? '';
  if (!suffix || suffix.includes('..')) {
    return new Response(JSON.stringify({ error: 'Missing path.', code: 'BAD_PATH' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const target = new URL(`/api/${suffix}${incoming.searchParams.get('qs') ? `?${incoming.searchParams.get('qs')}` : ''}`, CITY_ORIGIN);
  // Preserve original query string when the rewrite did not pack it into qs.
  if (!incoming.searchParams.get('qs') && [...incoming.searchParams.keys()].some((k) => k !== 'path')) {
    const forward = new URLSearchParams(incoming.searchParams);
    forward.delete('path');
    target.search = forward.toString();
  }
  if (target.origin !== new URL(CITY_ORIGIN).origin) {
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
