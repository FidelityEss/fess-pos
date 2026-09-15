/**
 * Typed remote config (docs/13 §5, B7.2). Every key has a type, a default and — where it tunes
 * behaviour — bounds; plus the per-key flags `integrity_relevant` (four-eyes + diff highlighting),
 * `host_overridable` and `client_safe` (only client-safe values ever leave the server; all current
 * keys are client-safe — the flag is kept for future server-only keys).
 *
 * Mirrors schema/config/remote-config.schema.json and schema/config/defaults.json (sync-tested).
 * Changing a bound is a code-reviewed schema change, never an admin action (docs/07 §6).
 */
import { z } from "zod";
import type { JsonObject, JsonValue } from "../json.ts";
import { deepEqual, isPlainObject } from "../json.ts";
import { pointer } from "../definitions/parse.ts";

export type ConfigLeafType = "boolean" | "integer" | "number" | "string" | "semver" | "enum" | "int_pair" | "profiles" | "flags";

export interface ConfigKeySpec {
  readonly path: string;
  readonly type: ConfigLeafType;
  readonly default: JsonValue;
  readonly nullable?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly values?: readonly string[];
  readonly pattern?: string;
  readonly integrityRelevant: boolean;
  readonly hostOverridable: boolean;
  readonly clientSafe: boolean;
  readonly description: string;
}

const k = (
  path: string,
  type: ConfigLeafType,
  dflt: JsonValue,
  description: string,
  extra: Partial<Omit<ConfigKeySpec, "path" | "type" | "default" | "description">> = {},
): ConfigKeySpec => ({
  path,
  type,
  default: dflt,
  description,
  integrityRelevant: extra.integrityRelevant ?? false,
  hostOverridable: extra.hostOverridable ?? false,
  clientSafe: extra.clientSafe ?? true,
  ...(extra.nullable !== undefined ? { nullable: extra.nullable } : {}),
  ...(extra.min !== undefined ? { min: extra.min } : {}),
  ...(extra.max !== undefined ? { max: extra.max } : {}),
  ...(extra.values !== undefined ? { values: extra.values } : {}),
  ...(extra.pattern !== undefined ? { pattern: extra.pattern } : {}),
});

const IR = { integrityRelevant: true } as const;

export const DEFAULT_GEOFENCE_PROFILES: JsonObject = {
  standalone: { radius_m: 75, max_accuracy_m: 30, exit_consecutive_fixes: 3, prompt_checkin_on_arrival: false },
  residential: { radius_m: 75, max_accuracy_m: 30, exit_consecutive_fixes: 3, prompt_checkin_on_arrival: false },
  shopping_centre: { radius_m: 250, max_accuracy_m: 75, exit_consecutive_fixes: 5, prompt_checkin_on_arrival: true },
  office_park: { radius_m: 200, max_accuracy_m: 75, exit_consecutive_fixes: 5, prompt_checkin_on_arrival: true },
  large_site: { radius_m: 300, max_accuracy_m: 75, exit_consecutive_fixes: 5, prompt_checkin_on_arrival: false },
};

/** Geofence profile bounds (docs/07 §6–7): radius 25–500 m. */
export const PROFILE_BOUNDS = {
  radius_m: { min: 25, max: 500 },
  max_accuracy_m: { min: 5, max: 150 },
  exit_consecutive_fixes: { min: 1, max: 10 },
} as const;

export const REMOTE_CONFIG_KEYS: readonly ConfigKeySpec[] = [
  k("maps.tile_url", "string", null, "Tile URL template ({z}/{x}/{y}); delivered by config so keys rotate without a release.", { nullable: true }),
  k("maps.api_key", "string", null, "Client-safe (publishable) map provider key.", { nullable: true }),
  k("maps.prefetch_zoom", "int_pair", [14, 17], "Zoom range prefetched per job bounding box.", { min: 1, max: 20 }),
  k("maps.wifi_only_prefetch", "boolean", false, "Prefetch tiles on Wi-Fi only."),
  k("observability.sentry_dsn", "string", null, "Module Sentry DSN (client-safe).", { nullable: true }),
  k("observability.sample_rate", "number", 0.2, "Sentry trace sample rate.", { min: 0, max: 1 }),
  k("geofence.sample_seconds", "integer", 60, "Location check sampling window (docs/07 §7.1).", { min: 10, max: 180, ...IR }),
  k("geofence.trace_interval_s", "integer", 20, "Fix interval during an inspection (docs/07 §7.8).", { min: 5, max: 120, ...IR }),
  k("geofence.outside_fix.allowed", "boolean", true, "No GPS lock inside → a fix immediately outside counts (D-09).", IR),
  k("geofence.outside_fix.max_accuracy_m", "integer", 30, "Accuracy an outside fix must meet.", { min: 5, max: 100, ...IR }),
  k("geofence.outside_fix.valid_minutes", "integer", 20, "How recent the outside fix must be.", { min: 1, max: 120, ...IR }),
  k("geofence.override_radius_multiplier", "number", 2, "Override allowed within this × the profile radius.", { min: 1, max: 3, ...IR }),
  k("geofence.override_max_m", "integer", 500, "Absolute cap on the override distance.", { min: 25, max: 500, ...IR }),
  k("geofence.default_profile", "string", "standalone", "Profile used when a job has none (strictest).", { pattern: "^[a-z][a-z0-9_]{0,63}$", ...IR }),
  k("geofence.profiles", "profiles", DEFAULT_GEOFENCE_PROFILES, "Location profiles by location type (docs/07 §7).", IR),
  k("integrity.block_on_mock", "boolean", true, "Block beginning an inspection when mock location is active.", IR),
  k("integrity.block_on_root", "boolean", true, "Block on root / jailbreak / hooking (per bank).", IR),
  k("integrity.attestation_max_age_h", "integer", 24, "Max age of a cached attestation verdict.", { min: 1, max: 168, ...IR }),
  k("photos.max_long_edge_px", "integer", 2048, "Canonical image long edge.", { min: 1024, max: 4096, ...IR }),
  k("photos.jpeg_quality", "integer", 80, "Canonical image JPEG quality.", { min: 50, max: 95, ...IR }),
  k("auth.reverify_hours", "integer", 24, "Re-run the host-token exchange at most this often (docs/07 §2).", { min: 1, max: 168, ...IR }),
  k("auth.max_host_token_age_h", "integer", 696, "Refuse host tokens older than this (mirrors FESS tokenTime).", { min: 1, max: 2160, ...IR }),
  k("auth.access_token_ttl_s", "integer", 900, "POS access token lifetime.", { min: 300, max: 3600, ...IR }),
  k("auth.refresh_token_ttl_days", "integer", 30, "POS refresh token lifetime.", { min: 1, max: 90, ...IR }),
  k("sync.foreground_interval_s", "integer", 60, "Foreground sync interval while the outbox is non-empty.", { min: 15, max: 600 }),
  k("sync.idle_interval_s", "integer", 900, "Sync interval otherwise.", { min: 900, max: 86400 }),
  k("sync.retain_committed_payload_days", "integer", 30, "Committed payloads kept for restore-epoch re-send (docs/12 §12).", { min: 7, max: 365, ...IR }),
  k("sync.report_interval_s", "integer", 21600, "How often a device sends its sync report (sync_report, docs/12 §9); sooner when its battery restriction changes.", { min: 900, max: 86400 }),
  k("storage.cap_mb", "integer", 500, "Total module storage cap.", { min: 100, max: 4096 }),
  k("storage.block_new_work_at_pct", "integer", 80, "Block new inspections at this share of the cap.", { min: 50, max: 95 }),
  k("storage.tile_cache_mb", "integer", 150, "Map tile cache cap.", { min: 0, max: 1024 }),
  k("min_module_version.nag", "semver", "0.0.0", "Soft update banner below this version."),
  k("min_module_version.new_work", "semver", "0.0.0", "Hard gate on starting inspections / accepting jobs; never on uploads."),
  k("min_module_version.block_in_progress", "semver", "0.0.0", "Emergency gate on completing started work (data-corrupting bugs only); uploads continue.", IR),
  k("features", "flags", { repeatable_groups: true, inspection_snapshots: true }, "Optional feature flags (features.<x>); never affect uploads."),
  k("client_mode", "enum", "native", "Route agents to the web client (later).", { values: ["native", "web"], ...IR }),
  k("pos.enabled", "boolean", true, "Kill switch: hide the host entry point. Never stops background uploads."),
  k("inspections.start_enabled", "boolean", true, "Kill switch: no new inspections; in-progress ones finish."),
  k("governance.four_eyes_global", "boolean", false, "Four-eyes approval for global definitions and config (D-31).", IR),
  k("assignment.response_timeout_h", "integer", 24, "Assignment expires without a response after this (D-18).", { min: 1, max: 168 }),
  k("agent_card.token_ttl_h", "integer", 24, "Agent authorisation-card QR token lifetime (docs/07 §10).", { min: 1, max: 72, ...IR }),
  k("session_tokens.window_padding_h", "integer", 24, "Session token validity padding around the visit window (docs/07 §3).", { min: 0, max: 72, ...IR }),
  k("locale.timezone", "string", "Africa/Johannesburg", "IANA time zone for day boundaries (home tiles).", { pattern: "^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$" }),
  k("theme.primary_color", "string", null, "Brand colour (#RRGGBB); host may override.", { nullable: true, pattern: "^#[0-9A-Fa-f]{6}$", hostOverridable: true }),
  k("theme.font_family", "string", null, "Font family; host may override.", { nullable: true, hostOverridable: true }),
];

const SEMVER = /^\d+\.\d+\.\d+$/;
const KEY = /^[a-z][a-z0-9_]{0,63}$/;

function setPath(o: JsonObject, path: string, v: JsonValue): void {
  const parts = path.split(".");
  let cur = o;
  parts.slice(0, -1).forEach((p) => {
    if (!isPlainObject(cur[p])) cur[p] = {};
    cur = cur[p] as JsonObject;
  });
  cur[parts[parts.length - 1] as string] = v;
}

function getPath(o: JsonValue, path: string): JsonValue | undefined {
  let cur: JsonValue | undefined = o;
  for (const p of path.split(".")) {
    if (!isPlainObject(cur)) return undefined;
    cur = Object.prototype.hasOwnProperty.call(cur, p) ? (cur as JsonObject)[p] : undefined;
  }
  return cur;
}

/** The global default values document (schema/config/defaults.json). */
export function remoteConfigDefaults(): JsonObject {
  const out: JsonObject = {};
  for (const spec of REMOTE_CONFIG_KEYS) setPath(out, spec.path, JSON.parse(JSON.stringify(spec.default)) as JsonValue);
  return out;
}

export const REMOTE_CONFIG_DEFAULTS: JsonObject = remoteConfigDefaults();

const profileSchema = z
  .object({
    radius_m: z.number().int().min(PROFILE_BOUNDS.radius_m.min).max(PROFILE_BOUNDS.radius_m.max),
    max_accuracy_m: z.number().int().min(PROFILE_BOUNDS.max_accuracy_m.min).max(PROFILE_BOUNDS.max_accuracy_m.max),
    exit_consecutive_fixes: z.number().int().min(PROFILE_BOUNDS.exit_consecutive_fixes.min).max(PROFILE_BOUNDS.exit_consecutive_fixes.max),
    prompt_checkin_on_arrival: z.boolean(),
  })
  .strict();

function leafSchema(spec: ConfigKeySpec): z.ZodTypeAny {
  let s: z.ZodTypeAny;
  switch (spec.type) {
    case "boolean":
      s = z.boolean();
      break;
    case "integer": {
      let n = z.number().int();
      if (spec.min !== undefined) n = n.min(spec.min);
      if (spec.max !== undefined) n = n.max(spec.max);
      s = n;
      break;
    }
    case "number": {
      let n = z.number();
      if (spec.min !== undefined) n = n.min(spec.min);
      if (spec.max !== undefined) n = n.max(spec.max);
      s = n;
      break;
    }
    case "string": {
      let t = z.string().min(1).max(2000);
      if (spec.pattern) t = t.regex(new RegExp(spec.pattern));
      s = t;
      break;
    }
    case "semver":
      s = z.string().regex(SEMVER);
      break;
    case "enum":
      s = z.enum(spec.values as [string, ...string[]]);
      break;
    case "int_pair": {
      const n = z.number().int().min(spec.min ?? 0).max(spec.max ?? Number.MAX_SAFE_INTEGER);
      s = z.tuple([n, n]).refine(([a, b]) => a <= b, { message: "range must be ascending" });
      break;
    }
    case "profiles":
      s = z.record(z.string().regex(KEY), profileSchema).refine((r) => Object.keys(r).length > 0, { message: "at least one profile" });
      break;
    case "flags":
      s = z.record(z.string().regex(KEY), z.boolean());
      break;
  }
  return spec.nullable ? s.nullable() : s;
}

type Tree = { [k: string]: Tree | ConfigKeySpec };
function buildTree(): Tree {
  const root: Tree = {};
  for (const spec of REMOTE_CONFIG_KEYS) {
    const parts = spec.path.split(".");
    let cur = root;
    parts.slice(0, -1).forEach((p) => {
      cur[p] ??= {};
      cur = cur[p] as Tree;
    });
    cur[parts[parts.length - 1] as string] = spec;
  }
  return root;
}

function treeSchema(tree: Tree): z.ZodTypeAny {
  const shape: z.ZodRawShape = {};
  for (const [name, node] of Object.entries(tree)) {
    const isSpec = typeof (node as ConfigKeySpec).path === "string" && typeof (node as ConfigKeySpec).type === "string";
    shape[name] = (isSpec ? leafSchema(node as ConfigKeySpec) : treeSchema(node as Tree)).optional();
  }
  return z.object(shape).strict();
}

/** A config layer (global/bank/agent/device): every key optional, every present key typed and bounded. */
export const RemoteConfigLayerSchema = treeSchema(buildTree());

export interface ConfigIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Merge layers most-general first (global → bank → agent → device) over the defaults and validate.
 * Objects merge key by key; arrays and scalars replace; `geofence.profiles` entries merge per profile.
 */
export function resolveRemoteConfig(layers: readonly unknown[]): { ok: boolean; values: JsonObject; errors: ConfigIssue[] } {
  const errors: ConfigIssue[] = [];
  let values = JSON.parse(JSON.stringify(REMOTE_CONFIG_DEFAULTS)) as JsonObject;
  layers.forEach((layer, i) => {
    const res = RemoteConfigLayerSchema.safeParse(layer);
    if (!res.success) {
      for (const issue of res.error.issues) errors.push({ path: `layers[${i}]${pointer(issue.path)}`, message: issue.message });
      return;
    }
    values = merge(values, layer as JsonObject);
  });
  const profiles = getPath(values, "geofence.profiles");
  const dflt = getPath(values, "geofence.default_profile");
  if (typeof dflt === "string" && isPlainObject(profiles) && !Object.prototype.hasOwnProperty.call(profiles, dflt)) {
    errors.push({ path: "/geofence/default_profile", message: `default profile "${dflt}" is not defined` });
  }
  return { ok: errors.length === 0, values, errors };
}

function merge(base: JsonObject, over: JsonObject): JsonObject {
  const out: JsonObject = { ...base };
  for (const [k2, v] of Object.entries(over)) {
    const b = out[k2];
    out[k2] = isPlainObject(v) && isPlainObject(b) ? merge(b as JsonObject, v as JsonObject) : v;
  }
  return out;
}

/** Integrity-relevant key paths whose value differs between two config documents (four-eyes, diff highlighting). */
export function integrityRelevantChanges(before: JsonObject, after: JsonObject): string[] {
  return REMOTE_CONFIG_KEYS.filter((s) => s.integrityRelevant && !deepEqual(getPath(before, s.path) ?? null, getPath(after, s.path) ?? null)).map((s) => s.path);
}

/** Apply host overrides, honouring only keys marked host_overridable (docs/03 §3). Returns the rejected paths. */
export function applyHostOverrides(values: JsonObject, overrides: Readonly<Record<string, JsonValue>>): { values: JsonObject; rejected: string[] } {
  const out = JSON.parse(JSON.stringify(values)) as JsonObject;
  const rejected: string[] = [];
  for (const [path, v] of Object.entries(overrides)) {
    const spec = REMOTE_CONFIG_KEYS.find((s) => s.path === path);
    if (!spec?.hostOverridable || !leafSchema(spec).safeParse(v).success) {
      rejected.push(path);
      continue;
    }
    setPath(out, path, v);
  }
  return { values: out, rejected };
}

/** Only client-safe keys ever leave the server (docs/13 §5). */
export function clientSafeView(values: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const spec of REMOTE_CONFIG_KEYS) {
    if (!spec.clientSafe) continue;
    const v = getPath(values, spec.path);
    if (v !== undefined) setPath(out, spec.path, v);
  }
  return out;
}
