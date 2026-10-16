/** Forwards /healthz to the city process. */

export const config = { runtime: 'edge' };

const CITY_ORIGIN = (typeof process !== 'undefined' && process.env.FANATION_CITY_ORIGIN?.trim()) || 'https://did-cam-diameter-bill.trycloudflare.com';

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
