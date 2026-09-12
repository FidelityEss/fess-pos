'use client';

// Data for the phone preview (T3-23): reference data a definition points at (declarations, reason codes, lookup lists)
// and the active global definitions, assembled into a PreviewBundle. Read-only PostgREST reads under RLS. Each read
// degrades to "nothing" on failure so a missing grant never breaks the preview — it just shows sample options.
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { OptionDef } from '@/lib/engine';
import { fetchRows, pos } from '@/lib/supabase';
import type { DefinitionActivation, DefinitionKind } from '@/lib/types';
import { isPlainObject } from '@/lib/utils';
import type { PreviewBundle, PreviewLists } from './definition-preview';

export interface PreviewReferenceData {
  declarations: NonNullable<PreviewBundle['declarations']>;
  lists: PreviewLists;
}

const orEmpty = <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => []);

function toOptions(items: unknown): OptionDef[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((it): OptionDef[] => {
    if (!isPlainObject(it)) return [];
    const value = typeof it.value === 'string' ? it.value : typeof it.code === 'string' ? it.code : null;
    if (value === null) return [];
    const label = typeof it.label === 'string' ? it.label : value;
    return [{ value, label, ...(isPlainObject(it.meta) ? { meta: it.meta as OptionDef['meta'] } : {}) }];
  });
}

export async function fetchPreviewReferenceData(): Promise<PreviewReferenceData> {
  const [decls, codes, lists, listVersions] = await Promise.all([
    orEmpty(fetchRows<{ key: string; version: number; title: string; text: string }>(pos().from('declarations').select('key,version,title,text').order('version', { ascending: false }))),
    orEmpty(
      fetchRows<{ category: string; code: string; label: string; description: string | null; sort_order: number }>(
        pos().from('reason_codes').select('category,code,label,description,sort_order').eq('active', true).is('bank_id', null).order('sort_order'),
      ),
    ),
    orEmpty(fetchRows<{ id: string; key: string }>(pos().from('lookup_lists').select('id,key').is('bank_id', null))),
    orEmpty(fetchRows<{ list_id: string; version: number; items: unknown }>(pos().from('lookup_list_versions').select('list_id,version,items').order('version', { ascending: false }))),
  ]);

  const declarations: PreviewReferenceData['declarations'] = {};
  for (const d of decls) if (!declarations[d.key]) declarations[d.key] = { title: d.title, text: d.text };

  const reason_codes: Record<string, OptionDef[]> = {};
  for (const c of codes) {
    (reason_codes[c.category] ??= []).push({ value: c.code, label: c.label, ...(c.description ? { help_text: c.description } : {}) });
  }

  const lookup_lists: Record<string, OptionDef[]> = {};
  const keyById = new Map(lists.map((l) => [l.id, l.key]));
  for (const v of listVersions) {
    const key = keyById.get(v.list_id);
    if (key && !lookup_lists[key]) lookup_lists[key] = toOptions(v.items);
  }
  return { declarations, lists: { reason_codes, lookup_lists } };
}

/** Declarations, reason codes and lookup lists for previews (cached for 5 minutes). */
export function usePreviewReferenceData() {
  return useQuery({ queryKey: ['preview', 'reference'], queryFn: fetchPreviewReferenceData, staleTime: 5 * 60_000 });
}

// ── Active global definitions ────────────────────────────────────────────────────────────────────

export interface PreviewDefinitionRow {
  familyId: string;
  kind: DefinitionKind;
  key: string;
  title: string;
  version: number;
  versionId: string;
  /** False when no activation for everyone is in effect and the newest published version is used instead. */
  active: boolean;
  definition: Record<string, unknown>;
}

function inEffect(a: DefinitionActivation, now: number): boolean {
  return Date.parse(a.effective_from) <= now && (a.effective_to === null || Date.parse(a.effective_to) > now);
}

/**
 * The version in force for everyone of each global family (docs/04 §7: in-effect activations, newest first, the first
 * with audience "all"); falls back to the newest published version when nothing is active.
 */
export async function fetchActiveGlobalDefinitions(): Promise<PreviewDefinitionRow[]> {
  const [families, activations, versions] = await Promise.all([
    fetchRows<{ id: string; kind: DefinitionKind; key: string; title: string }>(pos().from('definition_families').select('id,kind,key,title').is('bank_id', null)),
    fetchRows<DefinitionActivation>(pos().from('definition_activations').select('*')),
    fetchRows<{ id: string; family_id: string; version: number }>(pos().from('definition_versions').select('id,family_id,version')),
  ]);
  const now = Date.now();
  const chosen: { family: (typeof families)[number]; versionId: string; active: boolean }[] = [];
  for (const family of families) {
    const live = activations
      .filter((a) => a.family_id === family.id && inEffect(a, now))
      .sort((x, y) => Date.parse(y.effective_from) - Date.parse(x.effective_from) || Date.parse(y.created_at) - Date.parse(x.created_at));
    const forAll = live.find((a) => a.audience.type === 'all');
    if (forAll) {
      chosen.push({ family, versionId: forAll.version_id, active: true });
      continue;
    }
    const newest = versions.filter((v) => v.family_id === family.id).sort((a, b) => b.version - a.version)[0];
    if (newest) chosen.push({ family, versionId: newest.id, active: false });
  }
  if (chosen.length === 0) return [];
  const docs = await fetchRows<{ id: string; version: number; definition: Record<string, unknown> }>(
    pos().from('definition_versions').select('id,version,definition').in('id', chosen.map((c) => c.versionId)),
  );
  const byId = new Map(docs.map((d) => [d.id, d]));
  return chosen.flatMap(({ family, versionId, active }) => {
    const doc = byId.get(versionId);
    return doc ? [{ familyId: family.id, kind: family.kind, key: family.key, title: family.title, version: doc.version, versionId, active, definition: doc.definition }] : [];
  });
}

/** Active global definitions (under the ['definitions'] prefix, so studio invalidations refresh them). */
export function useActiveGlobalDefinitions() {
  return useQuery({ queryKey: ['definitions', 'preview_active_global'], queryFn: fetchActiveGlobalDefinitions });
}

/** Build a PreviewBundle from definition documents (keyed by family key). Content strings merge in the given order. */
export function bundleFromDefinitions(
  rows: readonly { kind: DefinitionKind; key: string; definition: unknown }[],
  extra: Partial<PreviewBundle> = {},
): PreviewBundle {
  const forms: Record<string, unknown> = {};
  const flows: Record<string, unknown> = {};
  const views: Record<string, unknown> = {};
  let jobSchema: unknown;
  const strings: Record<string, string> = {};
  for (const r of rows) {
    if (r.kind === 'form') forms[r.key] = r.definition;
    else if (r.kind === 'flow') flows[r.key] = r.definition;
    else if (r.kind === 'view') views[r.key] = r.definition;
    else if (r.kind === 'job_schema') jobSchema ??= r.definition;
    else if (r.kind === 'content' && isPlainObject(r.definition) && isPlainObject(r.definition.strings)) {
      for (const [k, v] of Object.entries(r.definition.strings)) if (typeof v === 'string') strings[k] = v;
    }
  }
  return { forms, flows, views, jobSchema, strings, ...extra };
}

/**
 * Everything a preview of the global configuration needs: the active global definitions plus the reference data.
 * `override` replaces one definition (e.g. the draft being edited) so the rest of the bundle sees the draft.
 */
export function usePreviewBundle(override?: { kind: DefinitionKind; key: string; definition: unknown } | null): {
  bundle: PreviewBundle;
  rows: PreviewDefinitionRow[];
  isPending: boolean;
  error: unknown;
} {
  const defs = useActiveGlobalDefinitions();
  const ref = usePreviewReferenceData();
  const bundle = useMemo(() => {
    const rows: { kind: DefinitionKind; key: string; definition: unknown }[] = (defs.data ?? []).filter(
      (r) => !(override && r.kind === override.kind && r.key === override.key),
    );
    if (override) rows.push(override);
    return bundleFromDefinitions(rows, ref.data ? { declarations: ref.data.declarations, lists: ref.data.lists } : {});
  }, [defs.data, ref.data, override]);
  return { bundle, rows: defs.data ?? [], isPending: defs.isPending || ref.isPending, error: defs.error ?? ref.error };
}
