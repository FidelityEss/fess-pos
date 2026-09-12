// Plain-language summary of what a layer edit changes, against the layer's published version: "Shopping centre radius:
// 250 m → 200 m", "Photo quality: set to 85% (was inherited 80%)", "Removed override: Sync interval".
import type { ConfigLayer, JsonObject } from '@/lib/types';
import { isPlainObject } from '@/lib/utils';
import { getPath, jsonEqual, leafPaths } from './config-doc';
import { formatProfile, formatSettingValue, isUnknownPath, profileLabel, SETTING_KEYS, type SectionId } from './config-meta';
import { humanLabel } from '@/components/structured-view';

export interface ChangeLine {
  id: string;
  text: string;
  kind: 'changed' | 'set' | 'removed' | 'added';
  integrity: boolean;
  path: string;
  section: SectionId;
}

const PROFILE_FIELD_WORDS: Record<string, string> = {
  radius_m: 'radius',
  max_accuracy_m: 'GPS accuracy',
  exit_consecutive_fixes: 'exit readings',
  prompt_checkin_on_arrival: 'check-in prompt',
};

function profileField(field: string, v: unknown): string {
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (typeof v === 'number') return field.endsWith('_m') ? `${v} m` : String(v);
  return v === undefined ? 'not set' : String(v);
}

function obj(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? v : {};
}

export function describeChanges(baseline: JsonObject, doc: JsonObject, inherited: JsonObject, layer: ConfigLayer): ChangeLine[] {
  const was = layer === 'global' ? 'was the default' : 'was inherited';
  const now = layer === 'global' ? 'now the default' : 'now inherited';
  const out: ChangeLine[] = [];

  for (const k of SETTING_KEYS) {
    const b = getPath(baseline, k.path);
    const a = getPath(doc, k.path);
    if (jsonEqual(b, a)) continue;
    const base = { integrity: k.spec.integrityRelevant, section: k.section };

    if (k.spec.type === 'profiles' || k.spec.type === 'flags') {
      const bo = obj(b);
      const ao = obj(a);
      const io = obj(getPath(inherited, k.path));
      const names = [...new Set([...Object.keys(bo), ...Object.keys(ao)])].sort();
      for (const n of names) {
        const bp = bo[n];
        const ap = ao[n];
        const ip = io[n];
        if (jsonEqual(bp, ap)) continue;
        const path = `${k.path}.${n}`;
        if (k.spec.type === 'flags') {
          const label = `Feature "${humanLabel(n)}"`;
          const onOff = (v: unknown) => (v === true ? 'On' : 'Off');
          if (bp !== undefined && ap !== undefined) out.push({ ...base, id: path, path, kind: 'changed', text: `${label}: ${onOff(bp)} → ${onOff(ap)}` });
          else if (ap !== undefined)
            out.push({ ...base, id: path, path, kind: ip === undefined ? 'added' : 'set', text: ip === undefined ? `Added ${label}: ${onOff(ap)}` : `${label}: set to ${onOff(ap)} (${was} ${onOff(ip)})` });
          else out.push({ ...base, id: path, path, kind: 'removed', text: ip === undefined ? `Removed ${label}` : `Removed override: ${label} (${now} ${onOff(ip)})` });
          continue;
        }
        const label = profileLabel(n);
        if (bp !== undefined && ap !== undefined) {
          const fields = [...new Set([...Object.keys(obj(bp)), ...Object.keys(obj(ap))])];
          for (const f of fields) {
            const bv = obj(bp)[f];
            const av = obj(ap)[f];
            if (jsonEqual(bv, av)) continue;
            out.push({ ...base, id: `${path}.${f}`, path, kind: 'changed', text: `${label} ${PROFILE_FIELD_WORDS[f] ?? humanLabel(f).toLowerCase()}: ${profileField(f, bv)} → ${profileField(f, av)}` });
          }
        } else if (ap !== undefined) {
          if (ip === undefined) {
            out.push({ ...base, id: path, path, kind: 'added', text: `Added location type: ${label} (${formatProfile(ap)})` });
          } else {
            const diffs = Object.keys(obj(ap)).filter((f) => !jsonEqual(obj(ap)[f], obj(ip)[f]));
            if (diffs.length === 0) out.push({ ...base, id: path, path, kind: 'set', text: `${label}: now set on this layer (same values as ${layer === 'global' ? 'the default' : 'inherited'})` });
            for (const f of diffs) {
              out.push({ ...base, id: `${path}.${f}`, path, kind: 'set', text: `${label} ${PROFILE_FIELD_WORDS[f] ?? f}: set to ${profileField(f, obj(ap)[f])} (${was} ${profileField(f, obj(ip)[f])})` });
            }
          }
        } else {
          out.push({
            ...base,
            id: path,
            path,
            kind: 'removed',
            text: ip === undefined ? `Removed location type: ${label}` : `Removed override: ${label} (${now}: ${formatProfile(ip)})`,
          });
        }
      }
      continue;
    }

    const inh = getPath(inherited, k.path);
    if (b !== undefined && a !== undefined) out.push({ ...base, id: k.path, path: k.path, kind: 'changed', text: `${k.label}: ${formatSettingValue(k, b)} → ${formatSettingValue(k, a)}` });
    else if (a !== undefined) out.push({ ...base, id: k.path, path: k.path, kind: 'set', text: `${k.label}: set to ${formatSettingValue(k, a)} (${was} ${formatSettingValue(k, inh)})` });
    else out.push({ ...base, id: k.path, path: k.path, kind: 'removed', text: `Removed override: ${k.label} (${now} ${formatSettingValue(k, inh)})` });
  }

  // Keys outside the contract (kept untouched by the editor; only the JSON tab can change them).
  const unknown = [...new Set([...leafPaths(baseline), ...leafPaths(doc)])].filter(isUnknownPath);
  for (const p of unknown.sort()) {
    const b = getPath(baseline, p);
    const a = getPath(doc, p);
    if (jsonEqual(b, a)) continue;
    const kind = b === undefined ? 'added' : a === undefined ? 'removed' : 'changed';
    out.push({ id: `unknown:${p}`, path: p, kind, integrity: false, section: 'other', text: `Unrecognised setting "${p}": ${kind}` });
  }
  return out;
}
