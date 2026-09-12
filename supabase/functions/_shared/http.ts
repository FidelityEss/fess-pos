// Request plumbing shared by every route: request id propagation, body limits, JSON parsing, rate limiting.
import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { PosError } from './errors.ts';

export const REQUEST_ID_HEADER = 'x-pos-request-id';
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,80}$/;

/** Propagate the device's x-pos-request-id end to end (device → function → DB rows), or mint one. */
export const requestId: MiddlewareHandler = async (c, next) => {
  const incoming = c.req.header(REQUEST_ID_HEADER);
  const id = incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
  c.set('requestId', id);
  await next();
  c.header(REQUEST_ID_HEADER, id);
};

export function rid(c: Context): string {
  return (c.get('requestId') as string | undefined) ?? 'unknown';
}

export async function readJson<T>(c: Context, schema: z.ZodType<T>, maxBytes = 1_048_576): Promise<T> {
  const len = Number(c.req.header('content-length') ?? '0');
  if (len > maxBytes) throw new PosError('PAYLOAD_TOO_LARGE', `body exceeds ${maxBytes} bytes`);
  const text = await c.req.text();
  if (text.length > maxBytes) throw new PosError('PAYLOAD_TOO_LARGE', `body exceeds ${maxBytes} bytes`);
  let raw: unknown;
  try {
    raw = text.length ? JSON.parse(text) : {};
  } catch {
    throw new PosError('INVALID_REQUEST', 'body is not valid JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new PosError('INVALID_REQUEST', 'request failed validation', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return parsed.data;
}

export function clientIp(c: Context): string | null {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('cf-connecting-ip') ?? null;
}

// Per-isolate fixed-window limiter. Isolates are short-lived, so this is a speed bump, not a guarantee;
// public tokens are 128-bit random, which is what actually prevents enumeration (docs/07 §10).
const windows = new Map<string, { start: number; count: number }>();
export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) windows.clear();
    return;
  }
  w.count += 1;
  if (w.count > limit) throw new PosError('RATE_LIMITED', 'too many requests');
}
