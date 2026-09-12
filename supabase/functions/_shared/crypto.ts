// Small crypto helpers (Web Crypto). Canonical JSON hashing lives in the engine (engine/jcs.ts) — one implementation.

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
