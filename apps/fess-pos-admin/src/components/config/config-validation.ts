// Client-side validation of a layer document with the engine's RemoteConfigLayerSchema (the same typed, bounded contract
// the server applies), turned into plain-language messages placed next to the control they belong to.
import { toDottedPath } from '@/components/ops/ops-shared';
import { RemoteConfigLayerSchema } from '@/lib/engine';
import type { JsonObject, ValidationIssue } from '@/lib/types';
import { isPlainObject } from '@/lib/utils';
import { getPath } from './config-doc';
import { formatNumber, keyForPath, PROFILE_FIELDS, profileLabel, type Unit } from './config-meta';

export interface FieldIssue {
  /** Dotted path ("geofence.profiles.mall.radius_m"). */
  path: string;
  message: string;
}

interface LooseIssue {
  code: string;
  path: (string | number)[];
  message: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  type?: string;
  keys?: string[];
  expected?: string;
  received?: string;
}

function unitFor(path: string): Unit | null {
  const m = /^geofence\.profiles\.[^.]+\.(\w+)$/.exec(path);
  if (m) return PROFILE_FIELDS.find((f) => f.name === m[1])?.unit ?? null;
  return keyForPath(path)?.unit ?? null;
}

function friendly(issue: LooseIssue, path: string): string {
  const unit = unitFor(path);
  const key = keyForPath(path);
  switch (issue.code) {
    case 'too_small':
      if (issue.type === 'string') return 'Enter a value';
      if (issue.type === 'object' || issue.type === 'array') return issue.message;
      return `Too low. Enter ${formatNumber(Number(issue.minimum), unit)} or more.`;
    case 'too_big':
      if (issue.type === 'string') return 'This is too long';
      return `Too high. Enter ${formatNumber(Number(issue.maximum), unit)} or less.`;
    case 'invalid_type':
      if (issue.expected === 'integer') return 'Enter a whole number';
      if (issue.received === 'undefined') return 'This needs a value';
      if (issue.expected === 'number') return 'Enter a number';
      if (issue.expected === 'boolean') return 'Switch this on or off';
      if (issue.expected === 'string') return 'Enter some text';
      return 'This value isn’t the right kind';
    case 'invalid_string':
      if (/^(geofence\.profiles|features)\.[^.]+$/.test(path)) return 'Use only lowercase letters, numbers and underscores, starting with a letter';
      return key?.formatHint ?? 'This isn’t in the right format';
    case 'invalid_enum_value':
      return 'Choose one of the options';
    case 'custom':
      if (/ascending/.test(issue.message)) return 'The first value must not be higher than the second';
      if (/at least one profile/.test(issue.message)) return 'Keep at least one location type';
      return issue.message;
    default:
      return issue.message;
  }
}

/** Problems in a layer document (types, bounds, unknown keys) plus the effective default-profile check. */
export function validateLayer(doc: JsonObject, effective: JsonObject): FieldIssue[] {
  const out: FieldIssue[] = [];
  const res = RemoteConfigLayerSchema.safeParse(doc);
  if (!res.success) {
    for (const raw of res.error.issues as unknown as LooseIssue[]) {
      const base = raw.path.map(String).join('.');
      if (raw.code === 'unrecognized_keys') {
        for (const k of raw.keys ?? []) out.push({ path: base ? `${base}.${k}` : k, message: 'The app doesn’t recognise this setting' });
        continue;
      }
      out.push({ path: base, message: friendly(raw, base) });
    }
  }
  const dflt = getPath(effective, 'geofence.default_profile');
  const profiles = getPath(effective, 'geofence.profiles');
  if (typeof dflt === 'string' && isPlainObject(profiles) && !Object.prototype.hasOwnProperty.call(profiles, dflt)) {
    out.push({ path: 'geofence.default_profile', message: `"${profileLabel(dflt)}" is not one of the location types` });
  }
  return out;
}

/** Server issues (JSON pointers) → dotted paths. */
export function serverIssues(list: ValidationIssue[]): FieldIssue[] {
  return list.map((i) => ({ path: toDottedPath(i.path ?? i.field), message: i.message }));
}

/** Issues at a path or anywhere under it. */
export function issuesAt(issues: readonly FieldIssue[], path: string, exact = false): FieldIssue[] {
  return issues.filter((i) => i.path === path || (!exact && i.path.startsWith(`${path}.`)));
}
