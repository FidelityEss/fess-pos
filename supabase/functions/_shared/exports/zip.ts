// A small ZIP writer for exports (T6-03, D-102): stored or deflated entries, UTF-8 names, no ZIP64 (PKWARE APPNOTE 6.3.x,
// §4.3). Written here rather than pulled in as a library: the format is small and fixed, and deflate comes from the
// runtime's CompressionStream('deflate-raw'), so the edge functions take no new dependency. Photos are stored (they're
// already compressed); text is deflated when that makes it smaller.
//
// Limits: at most 65,535 entries and 4 GiB in total (no ZIP64). Exports are capped far below that (exports.max_file_mb).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE 802.3), as ZIP needs it. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null; // the runtime can't deflate: store instead
  }
}

/** MS-DOS date and time (2-second resolution), in UTC. */
function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.min(Math.max(d.getUTCFullYear(), 1980), 2107);
  return {
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
  };
}

export class ZipTooLarge extends Error {
  constructor(readonly bytes: number, readonly limit: number) {
    super(`the file would be larger than ${limit} bytes`);
  }
}

/** A file name inside the ZIP: forward slashes, no leading slash, no "." or ".." segments, no control characters. */
export function safeEntryName(name: string): string {
  const parts = name
    .replaceAll('\\', '/')
    .split('/')
    // deno-lint-ignore no-control-regex
    .map((p) => p.replace(/[\x00-\x1f\x7f:*?"<>|]/g, '_').trim())
    .filter((p) => p !== '' && p !== '.' && p !== '..');
  return parts.join('/') || 'file';
}

interface CentralRecord {
  name: Uint8Array;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
  date: number;
  time: number;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** Try deflate (kept only when smaller). Default: false (stored). */
  compress?: boolean;
  modified?: Date;
}

/** Builds a ZIP as a list of byte chunks (no single big copy); `finish()` returns them in order. */
export class ZipWriter {
  private readonly chunks: Uint8Array[] = [];
  private readonly central: CentralRecord[] = [];
  private readonly names = new Set<string>();
  private offset = 0;

  constructor(private readonly limitBytes = 0xffffffff) {}

  /** Bytes written so far (local headers and data; the directory is added by finish()). */
  get size(): number {
    return this.offset;
  }

  get count(): number {
    return this.central.length;
  }

  async add(entry: ZipEntry): Promise<string> {
    const name = safeEntryName(entry.name);
    if (this.names.has(name)) throw new Error(`duplicate entry ${name}`);
    if (this.central.length >= 0xffff) throw new Error('too many files for one ZIP');
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(entry.data);
    let method = 0;
    let body = entry.data;
    if (entry.compress && entry.data.length > 64) {
      const deflated = await deflateRaw(entry.data);
      if (deflated && deflated.length < entry.data.length) {
        method = 8;
        body = deflated;
      }
    }
    const next = this.offset + 30 + nameBytes.length + body.length;
    if (next + 46 + nameBytes.length + 22 > this.limitBytes) throw new ZipTooLarge(next, this.limitBytes);
    const { date, time } = dosDateTime(entry.modified ?? new Date());
    const header = new Uint8Array(30 + nameBytes.length);
    const v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true); // local file header signature
    v.setUint16(4, 20, true); // version needed: 2.0
    v.setUint16(6, 0x0800, true); // general purpose flag: UTF-8 names
    v.setUint16(8, method, true);
    v.setUint16(10, time, true);
    v.setUint16(12, date, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, body.length, true);
    v.setUint32(22, entry.data.length, true);
    v.setUint16(26, nameBytes.length, true);
    v.setUint16(28, 0, true); // no extra field
    header.set(nameBytes, 30);
    this.chunks.push(header, body);
    this.central.push({ name: nameBytes, method, crc, compressed: body.length, size: entry.data.length, offset: this.offset, date, time });
    this.names.add(name);
    this.offset = next;
    return name;
  }

  /** The central directory and end record; returns every chunk of the finished ZIP. */
  finish(): Uint8Array[] {
    const start = this.offset;
    let dirSize = 0;
    for (const r of this.central) {
      const rec = new Uint8Array(46 + r.name.length);
      const v = new DataView(rec.buffer);
      v.setUint32(0, 0x02014b50, true); // central directory header signature
      v.setUint16(4, (3 << 8) | 20, true); // made by: UNIX, 2.0
      v.setUint16(6, 20, true);
      v.setUint16(8, 0x0800, true);
      v.setUint16(10, r.method, true);
      v.setUint16(12, r.time, true);
      v.setUint16(14, r.date, true);
      v.setUint32(16, r.crc, true);
      v.setUint32(20, r.compressed, true);
      v.setUint32(24, r.size, true);
      v.setUint16(28, r.name.length, true);
      v.setUint16(30, 0, true); // extra
      v.setUint16(32, 0, true); // comment
      v.setUint16(34, 0, true); // disk
      v.setUint16(36, 0, true); // internal attributes
      v.setUint32(38, (0o100644 << 16) >>> 0, true); // external attributes: a regular file, rw-r--r--
      v.setUint32(42, r.offset, true);
      rec.set(r.name, 46);
      this.chunks.push(rec);
      dirSize += rec.length;
    }
    const end = new Uint8Array(22);
    const v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true); // end of central directory signature
    v.setUint16(8, this.central.length, true);
    v.setUint16(10, this.central.length, true);
    v.setUint32(12, dirSize, true);
    v.setUint32(16, start, true);
    this.chunks.push(end);
    return this.chunks;
  }
}

/** Joins chunks into one array (tests and small files). */
export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
