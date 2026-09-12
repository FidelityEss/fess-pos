// Display formatting. All dates render in Africa/Johannesburg (SAST, UTC+2, no DST).

export const TIME_ZONE = 'Africa/Johannesburg';
/** SAST offset; Johannesburg has no daylight saving, so this is constant. */
export const SAST_OFFSET = '+02:00';

type DateInput = string | number | Date | null | undefined;

/** Parse an ISO string / epoch ms / Date; null when missing or invalid. */
export function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dateTimeSecFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const numberFmt = new Intl.NumberFormat('en-ZA');

/** "12 Sep 2026, 14:03" (SAST); '—' when empty. */
export function formatDateTime(value: DateInput, opts: { seconds?: boolean } = {}): string {
  const d = toDate(value);
  if (!d) return '—';
  return (opts.seconds ? dateTimeSecFmt : dateTimeFmt).format(d);
}

/** "12 Sep 2026" (SAST); '—' when empty. */
export function formatDate(value: DateInput): string {
  const d = toDate(value);
  return d ? dateFmt.format(d) : '—';
}

/** "14:03" (SAST); '—' when empty. */
export function formatTime(value: DateInput): string {
  const d = toDate(value);
  return d ? timeFmt.format(d) : '—';
}

/** Milliseconds since `value` (negative when in the future); null when empty. */
export function ageMs(value: DateInput, now: number = Date.now()): number | null {
  const d = toDate(value);
  return d ? now - d.getTime() : null;
}

/** Compact duration: "45s", "12m", "3h 12m", "2d 3h". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const abs = Math.abs(ms);
  const s = Math.floor(abs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** Relative age: "just now", "5m ago", "in 2h", "3d ago". */
export function formatRelative(value: DateInput, now: number = Date.now()): string {
  const age = ageMs(value, now);
  if (age === null) return '—';
  if (Math.abs(age) < 45_000) return 'just now';
  return age >= 0 ? `${formatDuration(age)} ago` : `in ${formatDuration(age)}`;
}

/** "1.2 MB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** Thousands-separated number; '—' when empty. */
export function formatNumber(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : numberFmt.format(n);
}

export interface NamedPerson {
  first_name?: string | null;
  last_name?: string | null;
  employee_number?: string | null;
}

/** "Thandi Mokoena". */
export function fullName(p: NamedPerson | null | undefined): string {
  if (!p) return '—';
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return name || p.employee_number || '—';
}

/** "Thandi Mokoena (E1234)" — or just the name when there is no employee number. */
export function employeeName(p: NamedPerson | null | undefined): string {
  if (!p) return '—';
  const name = fullName(p);
  return p.employee_number && name !== p.employee_number ? `${name} (${p.employee_number})` : name;
}

/** "unable_to_complete" → "Unable to complete". */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const s = value.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** ISO → value for <input type="datetime-local"> in SAST ("2026-09-12T14:03"). */
export function toDateTimeLocalValue(value: DateInput): string {
  const d = toDate(value);
  if (!d) return '';
  const sast = new Date(d.getTime() + 2 * 3600_000);
  return sast.toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value (interpreted as SAST) → ISO string; undefined when empty/invalid. */
export function fromDateTimeLocalValue(local: string | null | undefined): string | undefined {
  if (!local) return undefined;
  const withSeconds = local.length === 16 ? `${local}:00` : local;
  const d = new Date(`${withSeconds}${SAST_OFFSET}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Shorten a UUID/hash for display: "0190c3a1…9f2e". */
export function shortId(value: string | null | undefined, head = 8, tail = 4): string {
  if (!value) return '—';
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
