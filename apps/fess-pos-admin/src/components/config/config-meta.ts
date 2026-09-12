// Plain-language metadata for the typed remote config contract (REMOTE_CONFIG_KEYS in the shared engine): which section a
// key lives in, its friendly label and one-line help, its unit, and whether only engineers would change it. Types,
// defaults, bounds and the integrity flag always come from the engine; this file only adds wording and layout.
import {
  Activity,
  CircleArrowUp,
  ClipboardList,
  Camera,
  Globe,
  IdCard,
  KeyRound,
  type LucideIcon,
  Map as MapIcon,
  MapPin,
  Palette,
  Power,
  RefreshCw,
  Scale,
  ShieldCheck,
  ToggleRight,
  Wrench,
} from 'lucide-react';
import { humanLabel } from '@/components/structured-view';
import { type ConfigKeySpec, REMOTE_CONFIG_KEYS } from '@/lib/engine';

export type SectionId =
  | 'availability'
  | 'updates'
  | 'location'
  | 'photos'
  | 'security'
  | 'sync'
  | 'assignment'
  | 'agent_card'
  | 'theme'
  | 'features'
  | 'governance'
  | 'auth'
  | 'maps'
  | 'monitoring'
  | 'locale'
  | 'other';

export interface SectionMeta {
  id: SectionId;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Whole section only in Advanced view ("Technical settings"). */
  technical: boolean;
  /** First path segments that belong here. */
  roots: readonly string[];
}

export const SECTIONS: readonly SectionMeta[] = [
  { id: 'availability', title: 'App availability', description: 'Turn the POS app, or new inspections, on and off. Captured work always keeps uploading.', icon: Power, technical: false, roots: ['pos', 'inspections', 'client_mode'] },
  { id: 'updates', title: 'App updates', description: 'Ask or require agents to update FESS before they work.', icon: CircleArrowUp, technical: false, roots: ['min_module_version'] },
  { id: 'location', title: 'Location checks', description: 'How close agents must be to the merchant before they can start an inspection.', icon: MapPin, technical: false, roots: ['geofence'] },
  { id: 'photos', title: 'Photos', description: 'The size and quality of the photos agents take.', icon: Camera, technical: false, roots: ['photos'] },
  { id: 'security', title: 'Security checks', description: 'Stop inspections on phones that could be used to fake evidence.', icon: ShieldCheck, technical: false, roots: ['integrity'] },
  { id: 'sync', title: 'Sync & storage', description: 'How often phones upload, and how much space the app may use.', icon: RefreshCw, technical: false, roots: ['sync', 'storage'] },
  { id: 'assignment', title: 'Job assignment', description: 'How long agents have to respond to a new job.', icon: ClipboardList, technical: false, roots: ['assignment'] },
  { id: 'agent_card', title: 'Agent card', description: 'The QR code merchants scan to check that an agent is authorised.', icon: IdCard, technical: false, roots: ['agent_card'] },
  { id: 'theme', title: 'Theme', description: 'The colour and font of the app.', icon: Palette, technical: false, roots: ['theme'] },
  { id: 'features', title: 'Features', description: 'Optional features you can switch on or off. Uploads are never affected.', icon: ToggleRight, technical: false, roots: ['features'] },
  { id: 'governance', title: 'Governance', description: 'Extra approval for sensitive changes.', icon: Scale, technical: false, roots: ['governance'] },
  { id: 'auth', title: 'Sign-in & sessions', description: 'How the POS app trusts the FESS sign-in, and how long sessions last.', icon: KeyRound, technical: true, roots: ['auth', 'session_tokens'] },
  { id: 'maps', title: 'Maps', description: 'Map tiles and offline map downloads.', icon: MapIcon, technical: true, roots: ['maps'] },
  { id: 'monitoring', title: 'Monitoring', description: 'Error reporting from the phones.', icon: Activity, technical: true, roots: ['observability'] },
  { id: 'locale', title: 'Locale', description: 'Time zone used for dates on the phone.', icon: Globe, technical: true, roots: ['locale'] },
  { id: 'other', title: 'Other settings', description: 'Settings without a section on this screen yet.', icon: Wrench, technical: true, roots: [] },
];

export const SECTION_BY_ID: Record<SectionId, SectionMeta> = Object.fromEntries(SECTIONS.map((s) => [s.id, s])) as Record<SectionId, SectionMeta>;

export interface Unit {
  /** After a number: "m", "%", " seconds". Includes its own leading space where needed. */
  suffix: string;
  /** Word for labels: "metres", "seconds". */
  word: string;
  /** Duration base in seconds (for "15 minutes" hints). */
  seconds?: number;
}

const UNITS: Record<string, Unit> = {
  seconds: { suffix: ' seconds', word: 'seconds', seconds: 1 },
  minutes: { suffix: ' minutes', word: 'minutes', seconds: 60 },
  hours: { suffix: ' hours', word: 'hours', seconds: 3600 },
  days: { suffix: ' days', word: 'days', seconds: 86400 },
  metres: { suffix: ' m', word: 'metres' },
  mb: { suffix: ' MB', word: 'MB' },
  pct: { suffix: '%', word: '%' },
  px: { suffix: ' px', word: 'pixels' },
  times: { suffix: '×', word: 'times' },
};

/** Unit from the key name (…_s, …_m, …_h, …_days, …_mb, …_pct, …_px). */
export function unitForKey(name: string): Unit | null {
  if (/_s$|_seconds$/.test(name)) return UNITS.seconds ?? null;
  if (/_minutes$/.test(name)) return UNITS.minutes ?? null;
  if (/_h$|_hours$/.test(name)) return UNITS.hours ?? null;
  if (/_days$/.test(name)) return UNITS.days ?? null;
  if (/_m$/.test(name)) return UNITS.metres ?? null;
  if (/_mb$/.test(name)) return UNITS.mb ?? null;
  if (/_pct$/.test(name)) return UNITS.pct ?? null;
  if (/_px$/.test(name)) return UNITS.px ?? null;
  return null;
}

interface KeyWording {
  label: string;
  help: string;
  /** Only engineers would change it: shown in Advanced view only. */
  technical?: boolean;
  unit?: keyof typeof UNITS | null;
  step?: number;
  /** Words for a boolean's two states. */
  onOff?: [string, string];
  /** Friendly labels for enum values. */
  options?: Record<string, string>;
  placeholder?: string;
  /** Hint for pattern-validated strings. */
  formatHint?: string;
}

const WORDING: Record<string, KeyWording> = {
  // App availability
  'pos.enabled': { label: 'POS app available to agents', help: 'Off hides the POS entry in FESS. Work already captured still uploads.', onOff: ['Available', 'Hidden'] },
  'inspections.start_enabled': { label: 'Agents can start new inspections', help: 'Off pauses new inspections. Agents can finish ones they have started, and uploads continue.', onOff: ['Allowed', 'Paused'] },
  client_mode: { label: 'App agents use', help: 'The phone app is the normal choice. The web app is for later and routes agents to a browser.', options: { native: 'Phone app', web: 'Web app' } },
  // App updates
  'min_module_version.nag': { label: 'Suggest an update below version', help: 'Phones on an older version see a "please update" banner. 0.0.0 turns this off.', formatHint: 'Use the format 1.4.0' },
  'min_module_version.new_work': { label: 'Require an update for new work below version', help: 'Older phones cannot accept jobs or start inspections until they update. Uploads and started work carry on. 0.0.0 turns this off.', formatHint: 'Use the format 1.4.0' },
  'min_module_version.block_in_progress': { label: 'Emergency: stop unfinished inspections below version', help: 'Only for serious bugs that damage data. Older phones cannot continue started inspections, but captured work still uploads. 0.0.0 turns this off.', formatHint: 'Use the format 1.4.0' },
  // Location checks
  'geofence.profiles': { label: 'Location types', help: 'How close agents must be, by the type of place the merchant is in.' },
  'geofence.default_profile': { label: 'Location type for jobs without one', help: 'Used when a job has no location type. Choose the strictest one.' },
  'geofence.outside_fix.allowed': { label: 'Accept a location recorded just outside', help: 'When there is no GPS signal inside the premises, a location recorded just outside counts.', onOff: ['Accepted', 'Not accepted'] },
  'geofence.outside_fix.max_accuracy_m': { label: 'Accuracy needed for that outside location', help: 'The outside location must be at least this accurate.' },
  'geofence.outside_fix.valid_minutes': { label: 'How recent that outside location must be', help: 'Older outside locations are not accepted.' },
  'geofence.override_radius_multiplier': { label: 'Overrides allowed up to', help: 'An agent just outside the fence may ask for an override, with a reason, within this many times the fence radius.', unit: 'times', step: 0.1 },
  'geofence.override_max_m': { label: 'Override distance limit', help: 'An override is never allowed further from the merchant than this.' },
  'geofence.sample_seconds': { label: 'Location check duration', help: 'How long the phone reads the location before deciding inside or outside.', technical: true },
  'geofence.trace_interval_s': { label: 'Location reading interval during an inspection', help: 'How often the phone records the location while an inspection is open.', technical: true },
  // Photos
  'photos.max_long_edge_px': { label: 'Photo size (long side)', help: 'Photos are saved at this size. Bigger photos show more detail but use more data and storage.', step: 128 },
  'photos.jpeg_quality': { label: 'Photo quality', help: 'Higher is sharper but makes bigger files. 80 is a good balance.', unit: 'pct' },
  // Security checks
  'integrity.block_on_mock': { label: 'Block when a fake-location app is on', help: 'Agents cannot start an inspection while the phone is faking its location.', onOff: ['Blocked', 'Allowed'] },
  'integrity.block_on_root': { label: 'Block on rooted or jailbroken phones', help: 'Agents cannot start an inspection on a phone whose security has been removed.', onOff: ['Blocked', 'Allowed'] },
  'integrity.attestation_max_age_h': { label: 'Phone security check stays valid for', help: 'How long the result of the phone security check can be reused.', technical: true },
  // Sync & storage
  'sync.foreground_interval_s': { label: 'Sync while work is waiting, every', help: 'How often the phone tries to upload while there is captured work waiting.' },
  'sync.idle_interval_s': { label: 'Sync when nothing is waiting, every', help: 'How often the phone checks in when there is nothing to upload.', technical: true },
  'sync.retain_committed_payload_days': { label: 'Keep uploaded work on the phone for', help: 'Kept so it can be re-sent if the server is ever restored from a backup.', technical: true },
  'storage.cap_mb': { label: 'Storage the app may use', help: 'Total space the POS app may use on the phone.' },
  'storage.block_new_work_at_pct': { label: 'Pause new inspections when storage is this full', help: 'Agents cannot start new inspections until uploads free up space. Started work carries on.' },
  'storage.tile_cache_mb': { label: 'Space for offline maps', help: 'Part of the storage above kept for map tiles.', technical: true },
  // Job assignment
  'assignment.response_timeout_h': { label: 'Time to accept or reject a job', help: 'If the agent does not respond in time, the job goes back to be reassigned.' },
  // Agent card
  'agent_card.token_ttl_h': { label: 'Agent card QR code valid for', help: 'Merchants scan the agent card to check the agent. The code renews after this time.' },
  // Theme
  'theme.primary_color': { label: 'Brand colour', help: 'Colour of the top bar and buttons. FESS may apply its own colour instead.', formatHint: 'Use a colour like #1D4ED8' },
  'theme.font_family': { label: 'Font', help: "Leave not set to use the phone's standard font. FESS may apply its own font instead.", placeholder: 'e.g. Roboto' },
  // Features
  features: { label: 'Optional features', help: 'Each feature can be switched on or off. Uploads are never affected.' },
  // Governance
  'governance.four_eyes_global': { label: "Global changes need a second admin's approval", help: 'When on, changes to global forms and security-related settings wait for another admin to approve them.', onOff: ['Required', 'Not required'] },
  // Technical: sign-in & sessions
  'auth.reverify_hours': { label: 'Re-check the FESS sign-in every', help: 'How often the POS app re-confirms the agent with FESS.' },
  'auth.max_host_token_age_h': { label: 'Refuse FESS sign-ins older than', help: 'Matches the FESS sign-in lifetime.' },
  'auth.access_token_ttl_s': { label: 'POS session token lifetime', help: 'Short-lived token used for each request.' },
  'auth.refresh_token_ttl_days': { label: 'Stay signed in for up to', help: 'After this the agent signs in through FESS again.' },
  'session_tokens.window_padding_h': { label: 'Visit token extra time', help: 'Extra validity around the booked visit window.' },
  // Technical: maps
  'maps.tile_url': { label: 'Map tile address', help: 'Template with {z}/{x}/{y}. Delivered here so it can change without an app release.', placeholder: 'https://…/{z}/{x}/{y}.png' },
  'maps.api_key': { label: 'Map provider key (public)', help: 'Publishable key only — never a secret.' },
  'maps.prefetch_zoom': { label: 'Map detail saved for offline use', help: 'Zoom levels downloaded around each job (higher shows more detail).' },
  'maps.wifi_only_prefetch': { label: 'Download offline maps on Wi-Fi only', help: 'Saves mobile data.', onOff: ['Wi-Fi only', 'Any connection'] },
  // Technical: monitoring
  'observability.sentry_dsn': { label: 'Error reporting address (Sentry DSN)', help: 'Where the phones send crash reports.' },
  'observability.sample_rate': { label: 'Share of sessions traced', help: '0 traces none, 1 traces every session.', step: 0.05 },
  // Technical: locale
  'locale.timezone': { label: 'Time zone', help: 'Decides when "today" starts on the home screen.', formatHint: 'An IANA time zone like Africa/Johannesburg' },
};

export interface SettingKey {
  spec: ConfigKeySpec;
  path: string;
  section: SectionId;
  label: string;
  help: string;
  technical: boolean;
  unit: Unit | null;
  step: number;
  onOff: [string, string];
  options: Record<string, string>;
  placeholder?: string;
  formatHint?: string;
}

function sectionFor(path: string): SectionId {
  const root = path.split('.')[0] ?? '';
  return SECTIONS.find((s) => s.roots.includes(root))?.id ?? 'other';
}

function buildKey(spec: ConfigKeySpec): SettingKey {
  const w = WORDING[spec.path];
  const name = spec.path.split('.').pop() ?? spec.path;
  const unit = w?.unit === null ? null : w?.unit ? (UNITS[w.unit] ?? null) : unitForKey(name);
  return {
    spec,
    path: spec.path,
    section: sectionFor(spec.path),
    label: w?.label ?? humanLabel(spec.path.split('.').slice(-2).join(' ')),
    help: w?.help ?? spec.description,
    technical: w?.technical ?? SECTION_BY_ID[sectionFor(spec.path)].technical,
    unit,
    step: w?.step ?? (spec.type === 'number' ? 0.1 : 1),
    onOff: w?.onOff ?? ['On', 'Off'],
    options: w?.options ?? {},
    placeholder: w?.placeholder,
    formatHint: w?.formatHint,
  };
}

/** Every contract key with its wording, in contract order. */
export const SETTING_KEYS: readonly SettingKey[] = REMOTE_CONFIG_KEYS.map(buildKey);
export const SETTING_BY_PATH: ReadonlyMap<string, SettingKey> = new Map(SETTING_KEYS.map((k) => [k.path, k]));

/** Display order inside each section (keys not listed keep contract order after these). */
const ORDER: Partial<Record<SectionId, string[]>> = {
  availability: ['pos.enabled', 'inspections.start_enabled', 'client_mode'],
  updates: ['min_module_version.nag', 'min_module_version.new_work', 'min_module_version.block_in_progress'],
  location: [
    'geofence.profiles',
    'geofence.default_profile',
    'geofence.override_radius_multiplier',
    'geofence.override_max_m',
    'geofence.outside_fix.allowed',
    'geofence.outside_fix.max_accuracy_m',
    'geofence.outside_fix.valid_minutes',
  ],
  sync: ['sync.foreground_interval_s', 'storage.cap_mb', 'storage.block_new_work_at_pct'],
};

export function keysForSection(id: SectionId): SettingKey[] {
  const keys = SETTING_KEYS.filter((k) => k.section === id);
  const order = ORDER[id] ?? [];
  const rank = (p: string) => (order.includes(p) ? order.indexOf(p) : order.length + SETTING_KEYS.findIndex((k) => k.path === p));
  return [...keys].sort((a, b) => rank(a.path) - rank(b.path));
}

/** The contract key a dotted path belongs to (itself or an ancestor), e.g. geofence.profiles.x.radius_m → geofence.profiles. */
export function keyForPath(path: string): SettingKey | undefined {
  let p = path;
  for (;;) {
    const k = SETTING_BY_PATH.get(p);
    if (k) return k;
    const i = p.lastIndexOf('.');
    if (i < 0) return undefined;
    p = p.slice(0, i);
  }
}

/** True when a path is not part of the contract (neither a key, inside a key, nor a parent of keys). */
export function isUnknownPath(path: string): boolean {
  if (keyForPath(path)) return false;
  return !SETTING_KEYS.some((k) => k.path.startsWith(`${path}.`));
}

// ── Geofence profile fields ─────────────────────────────────────────────────────────────────────
export const PROFILE_FIELDS = [
  { name: 'radius_m', label: 'Fence radius', help: 'Agents must be within this distance of the merchant.', unit: UNITS.metres as Unit, step: 5 },
  { name: 'max_accuracy_m', label: 'GPS accuracy needed', help: 'Location readings less accurate than this are ignored.', unit: UNITS.metres as Unit, step: 5 },
  { name: 'exit_consecutive_fixes', label: 'Readings outside before "left the site"', help: 'Avoids false alarms from one bad GPS reading.', unit: null, step: 1 },
] as const;

export const PROFILE_CHECKIN = {
  name: 'prompt_checkin_on_arrival',
  label: 'Ask the agent to check in outside first',
  help: 'Useful where GPS is weak indoors, such as malls and office parks.',
} as const;

/** "shopping_centre" → "Shopping centre". */
export function profileLabel(key: string): string {
  return humanLabel(key);
}

// ── Value formatting ────────────────────────────────────────────────────────────────────────────
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** 900 → "15 minutes", 86400 → "1 day"; null when the plain number already reads well. */
export function durationHint(value: number, unit: Unit | null): string | null {
  if (!unit?.seconds || !Number.isFinite(value)) return null;
  const s = value * unit.seconds;
  if (unit.seconds === 1 && s < 120) return null;
  if (unit.seconds === 3600 && s < 3 * 86400) return null;
  if (unit.seconds === 86400) return null;
  if (unit.seconds === 60 && s < 7200) return null;
  if (s % 86400 === 0) return plural(s / 86400, 'day');
  if (s % 3600 === 0) return plural(s / 3600, 'hour');
  if (s >= 3600) return `${(s / 3600).toFixed(1)} hours`;
  if (s % 60 === 0) return plural(s / 60, 'minute');
  return `${(s / 60).toFixed(1)} minutes`;
}

export function formatNumber(n: number, unit: Unit | null): string {
  const text = n.toLocaleString('en-ZA', { maximumFractionDigits: 2 });
  return unit ? `${text}${unit.suffix}` : text;
}

/** A value in plain words for summaries and inherited-value displays. */
export function formatSettingValue(key: SettingKey | undefined, value: unknown): string {
  if (value === undefined) return 'not set';
  if (value === null) return 'Not set';
  if (typeof value === 'boolean') return key ? (value ? key.onOff[0] : key.onOff[1]) : value ? 'On' : 'Off';
  if (typeof value === 'number') return formatNumber(value, key?.unit ?? null);
  if (typeof value === 'string') {
    if (key?.spec.type === 'enum') return key.options[value] ?? value;
    if (key?.path === 'geofence.default_profile') return profileLabel(value);
    return value;
  }
  if (Array.isArray(value) && key?.spec.type === 'int_pair') return `${String(value[0])} to ${String(value[1])}`;
  if (Array.isArray(value)) return value.map(String).join(', ');
  return 'a group of settings';
}

export function formatProfile(p: unknown): string {
  if (!p || typeof p !== 'object') return '—';
  const o = p as Record<string, unknown>;
  const parts = [
    typeof o.radius_m === 'number' ? `radius ${o.radius_m} m` : null,
    typeof o.max_accuracy_m === 'number' ? `accuracy ±${o.max_accuracy_m} m` : null,
    typeof o.exit_consecutive_fixes === 'number' ? plural(o.exit_consecutive_fixes, 'exit reading') : null,
    typeof o.prompt_checkin_on_arrival === 'boolean' ? `check-in prompt ${o.prompt_checkin_on_arrival ? 'on' : 'off'}` : null,
  ];
  return parts.filter(Boolean).join(', ');
}
