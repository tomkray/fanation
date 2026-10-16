/** Small HTTP helpers shared by the route modules (Node native http). */

import { IncomingMessage, ServerResponse } from 'node:http';
import { ApiErrorDto } from '../../shared/apiContract.js';

export const JSON_BODY_LIMIT = 16_384;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export async function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > limit) {
      throw new HttpError(413, 'BODY_TOO_LARGE', `Body exceeds ${limit} bytes.`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf-8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Body is not valid JSON.');
  }
}

/** A JSON object body, or a 400. */
export async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = parseJson(await readRawBody(req, JSON_BODY_LIMIT));
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'INVALID_BODY', 'Body must be a JSON object.');
  }
  return body as Record<string, unknown>;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  const body: ApiErrorDto = { error: message, code };
  sendJson(res, status, body);
}

export function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function parseCookies(req: IncomingMessage): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (header(req, 'cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      jar.set(part.slice(0, eq).trim(), decodeURIComponent(part.slice(eq + 1).trim()));
    }
  }
  return jar;
}

/** HttpOnly + SameSite=Lax always; Secure whenever the request came over HTTPS (directly or via the proxy). */
export function cookie(req: IncomingMessage, name: string, value: string, maxAgeSeconds: number, path = '/'): string {
  const secure = header(req, 'x-forwarded-proto') === 'https' || (req.socket as { encrypted?: boolean }).encrypted === true;
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** Positive integer amount sent as a decimal string (or a safe integer). */
export function readAmount(value: unknown, field: string): bigint {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^\d{1,15}$/.test(text) || BigInt(text) <= 0n) {
    throw new HttpError(400, 'INVALID_AMOUNT', `${field} must be a positive whole number.`);
  }
  return BigInt(text);
}
