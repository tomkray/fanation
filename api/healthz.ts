/** Forwards /healthz to the city process (via /api/healthz rewrite). */

export const config = { runtime: 'edge' };

const CITY_ORIGIN = 'https://toms-macbook-pro.tail3998b5.ts.net';

export default async function handler(): Promise<Response> {
  try {
    const upstream = await fetch(`${CITY_ORIGIN}/healthz`, { cache: 'no-store' });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'upstream failed';
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
