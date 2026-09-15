// Plain-language metadata for the typed remote config contract (REMOTE_CONFIG_KEYS in the shared engine): which section a
// key lives in, its friendly label and one-line help, its unit, and whether only engineers would change it. Types,
// defaults, bounds and the integrity flag always come from the engine; this file only adds wording and layout.
// Wording follows docs/17 §2 and §4.4: say what the setting changes for the agent, in words an office user would use.
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
  { id: 'availability', title: 'App on or off', description: 'Turn the POS app, or new visits, on and off. Work already done always keeps uploading.', icon: Power, technical: false, roots: ['pos', 'inspections', 'client_mode'] },
  { id: 'updates', title: 'App updates', description: 'Ask agents, or require them, to update the FESS app before they work.', icon: CircleArrowUp, technical: false, roots: ['min_module_version'] },
  { id: 'location', title: 'Location checks', description: 'How close agents must be to the merchant before they can start a visit.', icon: MapPin, technical: false, roots: ['geofence'] },
  { id: 'photos', title: 'Photos', description: 'The size and quality of the photos agents take.', icon: Camera, technical: false, roots: ['photos'] },
  { id: 'security', title: 'Phone security', description: 'Stop visits on phones that could be used to fake photos or locations.', icon: ShieldCheck, technical: false, roots: ['integrity'] },
  { id: 'sync', title: 'Uploading and phone storage', description: 'How often phones send their work, and how much space the app may use.', icon: RefreshCw, technical: false, roots: ['sync', 'storage'] },
  { id: 'assignment', title: 'New jobs for agents', description: 'How long agents have to accept or turn down a new job.', icon: ClipboardList, technical: false, roots: ['assignment'] },
  { id: 'agent_card', title: 'Agent card', description: 'The QR code merchants scan to check that an agent is allowed to visit them.', icon: IdCard, technical: false, roots: ['agent_card'] },
  { id: 'theme', title: 'Look of the app', description: 'The colour and font of the app.', icon: Palette, technical: false, roots: ['theme'] },
  { id: 'features', title: 'Optional features', description: 'Extra features you can switch on or off. Uploads are never affected.', icon: ToggleRight, technical: false, roots: ['features'] },
  { id: 'governance', title: 'Second approval', description: 'Whether changes that affect security need a second person to approve them.', icon: Scale, technical: false, roots: ['governance'] },
  { id: 'auth', title: 'Sign-in', description: 'How the POS app trusts the FESS sign-in, and how long agents stay signed in.', icon: KeyRound, technical: true, roots: ['auth', 'session_tokens'] },
  { id: 'maps', title: 'Maps', description: 'Where map pictures come from, and maps saved for use without signal.', icon: MapIcon, technical: true, roots: ['maps'] },
  { id: 'monitoring', title: 'Error reports', description: 'Crash and error reports sent from the phones.', icon: Activity, technical: true, roots: ['observability'] },
  { id: 'locale', title: 'Time zone', description: 'The time zone used for dates on the phone.', icon: Globe, technical: true, roots: ['locale'] },
  { id: 'other', title: 'Other settings', description: 'Settings this screen doesn’t have a place for yet.', icon: Wrench, technical: true, roots: [] },
];

export const SECTION_BY_ID: Record<SectionId, SectionMeta> = Object.fromEntries(SECTIONS.map((s) => [s.id, s])) as Record<SectionId, SectionMeta>;

export interface Unit {
  /** After a number: " metres", "%", " seconds". Includes its own leading space where needed. */
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
  metres: { suffix: ' metres', word: 'metres' },
  mb: { suffix: ' MB', word: 'MB' },
  pct: { suffix: '%', word: '%' },
  px: { suffix: ' pixels', word: 'pixels' },
  times: { suffix: ' times', word: 'times' },
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
  // App on or off
  'pos.enabled': { label: 'Agents can open the POS app', help: 'When this is off, agents don’t see POS in the FESS app. Work they’ve already done still uploads.', onOff: ['Available', 'Hidden'] },
  'inspections.start_enabled': { label: 'Agents can start new visits', help: 'When this is off, agents can’t start new visits. They can finish visits they’ve started, and uploads carry on.', onOff: ['Allowed', 'Paused'] },
  client_mode: { label: 'Which app agents use', help: 'The phone app is the normal choice. The web app is for later: it opens POS in a web browser instead.', options: { native: 'Phone app', web: 'Web app' } },
  // App updates
  'min_module_version.nag': { label: 'Suggest an update to versions older than', help: 'Phones with an older version of the app see a “please update” message. Enter 0.0.0 to turn this off.', formatHint: 'Enter a version number such as 1.4.0' },
  'min_module_version.new_work': { label: 'Require an update before new work, for versions older than', help: 'Phones with an older version can’t accept jobs or start visits until they update. Visits already started and uploads carry on. Enter 0.0.0 to turn this off.', formatHint: 'Enter a version number such as 1.4.0' },
  'min_module_version.block_in_progress': { label: 'Emergency: stop unfinished visits on versions older than', help: 'Only for serious faults that damage data. Phones with an older version can’t carry on with visits they’ve started, but work already done still uploads. Enter 0.0.0 to turn this off.', formatHint: 'Enter a version number such as 1.4.0' },
  // Location checks
  'geofence.profiles': { label: 'Location types', help: 'How close agents must be to the merchant, depending on the kind of place it’s in, such as a mall or a shop on its own.' },
  'geofence.default_profile': { label: 'Location type for jobs without one', help: 'Used when a job doesn’t say what kind of place the merchant is in. Choose the strictest one.' },
  'geofence.outside_fix.allowed': { label: 'Accept a location taken just outside', help: 'Some buildings have no GPS signal inside. When this is on, a location the agent records just outside the building counts.', onOff: ['Accepted', 'Not accepted'] },
  'geofence.outside_fix.max_accuracy_m': { label: 'How accurate that outside location must be', help: 'The location recorded outside must be accurate to within this many metres.' },
  'geofence.outside_fix.valid_minutes': { label: 'How recent that outside location must be', help: 'A location recorded outside longer ago than this doesn’t count.' },
  'geofence.override_radius_multiplier': { label: 'Starting away from the site: allowed up to', help: 'An agent just outside the site area can still start the visit, with a reason, if they’re within this many times the size of the site area.', unit: 'times', step: 0.1 },
  'geofence.override_max_m': { label: 'Starting away from the site: never further than', help: 'Agents can never start a visit away from the site if they’re further than this from the merchant.' },
  'geofence.sample_seconds': { label: 'How long the location check takes', help: 'How long the phone reads its location before deciding whether the agent is at the site.', technical: true },
  'geofence.trace_interval_s': { label: 'How often the location is recorded during a visit', help: 'While a visit is open, the phone records where it is this often, for the location trail.', technical: true },
  // Photos
  'photos.max_long_edge_px': { label: 'Photo size (longest side)', help: 'Photos are saved at this size. Bigger photos show more detail but use more mobile data and storage.', step: 128 },
  'photos.jpeg_quality': { label: 'Photo quality', help: 'Higher is sharper but makes bigger files. 80% is a good balance.', unit: 'pct' },
  // Phone security
  'integrity.block_on_mock': { label: 'Stop visits when a fake-location app is on', help: 'Agents can’t start a visit while their phone is pretending to be somewhere else.', onOff: ['Blocked', 'Allowed'] },
  'integrity.block_on_root': { label: 'Stop visits on phones with their security removed', help: 'Agents can’t start a visit on a phone that has been “rooted” or “jailbroken”, which removes its built-in security.', onOff: ['Blocked', 'Allowed'] },
  'integrity.attestation_max_age_h': { label: 'Phone security check stays valid for', help: 'How long the result of the phone’s security check can be reused before it’s checked again.', technical: true },
  // Uploading and phone storage
  'sync.foreground_interval_s': { label: 'When work is waiting, try to upload every', help: 'How often the phone tries to send work that hasn’t reached us yet.' },
  'sync.idle_interval_s': { label: 'When nothing is waiting, check in every', help: 'How often the phone checks in when it has nothing to send.', technical: true },
  'sync.retain_committed_payload_days': { label: 'Keep sent work on the phone for', help: 'Work stays on the phone this long after it reached us, so it can be sent again if our records ever have to be restored from a backup.', technical: true },
  'sync.report_interval_s': { label: 'Phone status report every', help: 'How often each phone tells us what it still has to send, how much space it has left and its battery settings. It also reports straight away when its battery settings change.', technical: true },
  'storage.cap_mb': { label: 'Space the app may use on the phone', help: 'The most space the POS app may take up on the phone.' },
  'storage.block_new_work_at_pct': { label: 'Pause new visits when storage is this full', help: 'Agents can’t start new visits until uploads free up space. Visits already started carry on.' },
  'storage.tile_cache_mb': { label: 'Space for maps saved on the phone', help: 'Part of the space above, kept for maps the agent can use without signal.', technical: true },
  // New jobs for agents
  'assignment.response_timeout_h': { label: 'Time an agent has to accept or turn down a job', help: 'If the agent doesn’t answer in time, the job comes back so it can be given to someone else.' },
  // Agent card
  'agent_card.token_ttl_h': { label: 'Agent card QR code stays valid for', help: 'Merchants scan the QR code on the agent’s card to check they’re allowed to visit. The code changes after this time.' },
  // Look of the app
  'theme.primary_color': { label: 'Main colour', help: 'The colour of the top bar and buttons. The FESS app may use its own colour instead.', formatHint: 'Enter a colour code such as #1D4ED8' },
  'theme.font_family': { label: 'Font', help: 'Leave it not set to use the phone’s standard font. The FESS app may use its own font instead.', placeholder: 'Roboto' },
  // Optional features
  features: { label: 'Optional features', help: 'Switch each feature on or off. Uploads are never affected.' },
  // Second approval
  'governance.four_eyes_global': { label: 'Changes for everyone need a second approval', help: 'When this is on, a second person must approve changes to the questions used for every bank, and to settings that affect security.', onOff: ['Required', 'Not required'] },
  // Technical: sign-in
  'auth.reverify_hours': { label: 'Check the agent’s FESS sign-in again every', help: 'How often the POS app checks with FESS that the agent is still allowed in.' },
  'auth.max_host_token_age_h': { label: 'Refuse FESS sign-ins older than', help: 'Should match how long a FESS sign-in lasts.' },
  'auth.access_token_ttl_s': { label: 'Each short sign-in pass lasts', help: 'The phone uses a short-lived pass for each request and renews it by itself.' },
  'auth.refresh_token_ttl_days': { label: 'Agents stay signed in for up to', help: 'After this, the agent signs in again through FESS.' },
  'session_tokens.window_padding_h': { label: 'Extra time around the booked visit', help: 'Visit passes stay valid this long before and after the agreed visit time.' },
  // Technical: maps
  'maps.tile_url': { label: 'Map picture address', help: 'The web address the phone loads map pictures from. It must contain {z}/{x}/{y}. It’s set here so it can change without a new app version.', placeholder: 'https://…/{z}/{x}/{y}.png' },
  'maps.api_key': { label: 'Map provider key (public)', help: 'Only the public key. Never a secret key.' },
  'maps.prefetch_zoom': { label: 'Map detail saved for use without signal', help: 'How closely zoomed the maps saved around each job are. Higher shows more detail.' },
  'maps.wifi_only_prefetch': { label: 'Save maps on Wi-Fi only', help: 'Saves mobile data.', onOff: ['Wi-Fi only', 'Any connection'] },
  // Technical: error reports
  'observability.sentry_dsn': { label: 'Error report address', help: 'Where the phones send crash reports (the Sentry address).' },
  'observability.sample_rate': { label: 'Share of app sessions measured for speed', help: '0 measures none, 1 measures every session.', step: 0.05 },
  // Technical: time zone
  'locale.timezone': { label: 'Time zone', help: 'Decides when “today” starts on the agent’s home screen.', formatHint: 'Enter a time zone name such as Africa/Johannesburg' },
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
  { name: 'radius_m', label: 'Size of the site area', help: 'Agents must be within this distance of the merchant’s pin.', unit: UNITS.metres as Unit, step: 5 },
  { name: 'max_accuracy_m', label: 'GPS accuracy needed', help: 'Location readings less accurate than this are ignored.', unit: UNITS.metres as Unit, step: 5 },
  { name: 'exit_consecutive_fixes', label: 'Readings outside before “left the site”', help: 'Stops one bad GPS reading from making it look as if the agent left.', unit: null, step: 1 },
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
    typeof o.radius_m === 'number' ? `site area ${o.radius_m} metres` : null,
    typeof o.max_accuracy_m === 'number' ? `GPS accurate to ${o.max_accuracy_m} metres` : null,
    typeof o.exit_consecutive_fixes === 'number' ? `${plural(o.exit_consecutive_fixes, 'reading')} before “left the site”` : null,
    typeof o.prompt_checkin_on_arrival === 'boolean' ? (o.prompt_checkin_on_arrival ? 'asks to check in outside first' : 'no check-in outside') : null,
  ];
  return parts.filter(Boolean).join(', ');
}
