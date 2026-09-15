// Minimal POS API client (what the module's API client does, without the retry machinery).
import { apiUrl, env } from './env.ts';

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: { error?: { code?: string; message?: string; retryable?: boolean; details?: unknown } }) {
    super(`${status} ${body.error?.code ?? ''} ${body.error?.message ?? ''}`.trim());
  }
  get code(): string | undefined {
    return this.body.error?.code;
  }
}

export async function call<T = Record<string, unknown>>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  opts: { bearer?: string; body?: unknown; publishable?: boolean; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'x-pos-request-id': `scn-${crypto.randomUUID()}`, ...opts.headers };
  if (opts.publishable !== false) headers.apikey = env.publishableKey;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${apiUrl}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}
