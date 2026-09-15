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
  { path: 'pos.enabled', label: 'Agents can open the POS app', help: 'When this is off, agents don’t see POS in the FESS app. Work already done keeps uploading.' },
  { path: 'inspections.start_enabled', label: 'Agents can start new visits', help: 'When this is off, agents can’t start new visits. Visits already started can be finished.' },
  { path: 'client_mode', label: 'Which app agents use', help: 'The phone app, or the web app (for later).' },
];

export const MIN_VERSION_KEYS: readonly { path: string; label: string }[] = [
  { path: 'min_module_version.nag', label: 'Suggest an update to versions older than' },
  { path: 'min_module_version.new_work', label: 'Require an update before new work, for versions older than' },
  { path: 'min_module_version.block_in_progress', label: 'Emergency stop for versions older than' },
];
