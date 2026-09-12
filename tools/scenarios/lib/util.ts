// Small helpers shared by the scenario tools.

/** RFC 9562 UUIDv7 — time-ordered ids as the module generates them (docs/03 §7). */
export function uuidv7(at = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const ts = BigInt(at);
  for (let i = 0; i < 6; i++) bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Device wall time with the SAST offset, as the module records it (docs/06 §4). */
export function isoSast(d = new Date()): string {
  const shifted = new Date(d.getTime() + 2 * 3600_000);
  return shifted.toISOString().replace('Z', '+02:00');
}

export function todaySast(d = new Date()): string {
  return isoSast(d).slice(0, 10);
}

// A valid 1×1 baseline JPEG; each "photo" gets a unique COM segment so every capture has its own hash.
const BASE_JPEG = Uint8Array.from(atob(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
), (c) => c.charCodeAt(0));

export function fakeJpeg(label: string): Uint8Array {
  const text = new TextEncoder().encode(`fess-pos scenario photo · ${label} · ${crypto.randomUUID()}`);
  const len = text.length + 2;
  const seg = new Uint8Array(4 + text.length);
  seg.set([0xff, 0xfe, (len >> 8) & 0xff, len & 0xff]);
  seg.set(text, 4);
  const out = new Uint8Array(BASE_JPEG.length + seg.length);
  out.set(BASE_JPEG.subarray(0, 2), 0);           // SOI
  out.set(seg, 2);                                  // COM
  out.set(BASE_JPEG.subarray(2), 2 + seg.length);   // rest
  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class Check {
  passed = 0;
  failed: string[] = [];
  ok(cond: unknown, label: string): void {
    if (cond) {
      this.passed++;
      console.log(`  ✓ ${label}`);
    } else {
      this.failed.push(label);
      console.log(`  ✗ ${label}`);
    }
  }
  eq(actual: unknown, expected: unknown, label: string): void {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    this.ok(ok, ok ? label : `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
  summary(): number {
    console.log(`\n${this.passed} passed, ${this.failed.length} failed`);
    for (const f of this.failed) console.log(`  ✗ ${f}`);
    return this.failed.length === 0 ? 0 : 1;
  }
}
