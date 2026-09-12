// Integrity-relevant keys and the kill-switch summary, derived from the shared engine's typed config contract
// (REMOTE_CONFIG_KEYS). Server validation (POST /config/validate) and the server's changed_integrity_keys stay the
// source of truth for four-eyes; these are UI hints.
import { type EngineJsonObject, integrityRelevantChanges, REMOTE_CONFIG_KEYS } from '@/lib/engine';
import type { JsonObject } from '@/lib/types';

/** Dotted paths the contract marks integrity_relevant (four-eyes + diff highlighting, docs/13 §5, docs/07 §6). */
export const INTEGRITY_RELEVANT_KEYS: readonly string[] = REMOTE_CONFIG_KEYS.filter((s) => s.integrityRelevant).map((s) => s.path);

/** True when a dotted path is (or sits under) an integrity-relevant key. */
export function isIntegrityPath(path: string): boolean {
  return INTEGRITY_RELEVANT_KEYS.some((k) => path === k || path.startsWith(`${k}.`));
}

/** Integrity-relevant keys whose value differs between two layer documents (the engine's comparison, as the server does). */
export function changedIntegrityKeys(before: JsonObject, after: JsonObject): string[] {
  return integrityRelevantChanges(before as EngineJsonObject, after as EngineJsonObject);
}

/** Kill switches summarised on the config screen (docs/13 §4, §6). */
export const KILL_SWITCH_KEYS: readonly { path: string; label: string; help: string }[] = [
  { path: 'pos.enabled', label: 'POS app available to agents', help: 'Off hides the POS entry in FESS. Background uploads never stop.' },
  { path: 'inspections.start_enabled', label: 'Agents can start new inspections', help: 'Off pauses new inspections; started ones can finish.' },
  { path: 'client_mode', label: 'App agents use', help: 'Phone app (native), or the web app (later).' },
];

export const MIN_VERSION_KEYS: readonly { path: string; label: string }[] = [
  { path: 'min_module_version.nag', label: 'Update suggested below' },
  { path: 'min_module_version.new_work', label: 'New work needs an update below' },
  { path: 'min_module_version.block_in_progress', label: 'Emergency stop below' },
];
