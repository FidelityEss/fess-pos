'use client';

// Loads what the structured editors and the phone preview need to know about *other* definitions: the forms a flow walks,
// the views an app page shows, merged content strings, declarations, lookup lists and the job schema. Scope follows the
// family being edited: a global family sees global definitions; a bank override sees the bank's families on top of the
// global ones (same kind + key → the bank's wins). For each family the latest published version is used.
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { PreviewBundle } from '@/components/preview/definition-preview';
import { fetchRows, pos } from '@/lib/supabase';
import type { DefinitionFamily, DefinitionKind, JsonObject } from '@/lib/types';
import { defKeys, fetchAllVersionsLite, fetchFamilies } from '../definitions-data';
import { asArr, asObj, asStr } from './doc';

export interface RefOption {
  key: string;
  title: string;
}

export interface StudioRefs {
  bundle: PreviewBundle;
  /** Families of each kind visible in this scope (key + title), bank overrides merged over global. */
  families: Record<DefinitionKind, RefOption[]>;
  declarations: RefOption[];
  lookupLists: RefOption[];
  /** Page ids of the app definition(s) in scope — targets for view buttons and taps. */
  appPages: RefOption[];
  loading: boolean;
}

interface DeclRow {
  key: string;
  version: number;
  title: string;
  text: string;
}

interface ListRow {
  key: string;
  title: string;
  scope: string;
  bank_id: string | null;
}

const EMPTY_FAMILIES: Record<DefinitionKind, RefOption[]> = { form: [], flow: [], job_schema: [], view: [], content: [], app: [] };

export function useStudioRefs(family: Pick<DefinitionFamily, 'bank_id' | 'scope'>): StudioRefs {
  const bankId = family.scope === 'global' ? null : family.bank_id;
  const families = useQuery({ queryKey: defKeys.families, queryFn: fetchFamilies, staleTime: 60_000 });
  const versions = useQuery({ queryKey: defKeys.versionsLite, queryFn: fetchAllVersionsLite, staleTime: 60_000 });

  // Families in scope, bank ones winning over global ones with the same kind + key.
  const inScope = useMemo(() => {
    const byKindKey = new Map<string, DefinitionFamily>();
    const rows = (families.data ?? []).filter((f) => f.scope === 'global' || (bankId !== null && f.bank_id === bankId));
    for (const f of [...rows].sort((a, b) => (a.bank_id ? 1 : 0) - (b.bank_id ? 1 : 0))) byKindKey.set(`${f.kind}/${f.key}`, f);
    return [...byKindKey.values()];
  }, [families.data, bankId]);

  const latestIds = useMemo(() => {
    const latest = new Map<string, { id: string; version: number }>();
    const wanted = new Set(inScope.map((f) => f.id));
    for (const v of versions.data ?? []) {
      if (!wanted.has(v.family_id)) continue;
      const cur = latest.get(v.family_id);
      if (!cur || v.version > cur.version) latest.set(v.family_id, { id: v.id, version: v.version });
    }
    return [...latest.values()].map((x) => x.id).sort();
  }, [inScope, versions.data]);

  const defs = useQuery({
    queryKey: [...defKeys.all, 'bundle_defs', latestIds] as const,
    queryFn: () =>
      fetchRows<{ id: string; family_id: string; definition: JsonObject }>(pos().from('definition_versions').select('id,family_id,definition').in('id', latestIds)),
    enabled: latestIds.length > 0,
    staleTime: 60_000,
  });

  const declarations = useQuery({
    queryKey: ['declarations', 'studio-latest'] as const,
    queryFn: () => fetchRows<DeclRow>(pos().from('declarations').select('key,version,title,text').order('key').order('version', { ascending: false })),
    staleTime: 5 * 60_000,
  });

  const lists = useQuery({
    queryKey: ['lookup_lists', 'studio-keys'] as const,
    queryFn: () => fetchRows<ListRow>(pos().from('lookup_lists').select('key,title,scope,bank_id').order('key')),
    staleTime: 5 * 60_000,
  });

  return useMemo(() => {
    const byFamily = new Map((defs.data ?? []).map((d) => [d.family_id, d.definition]));
    const bundle: PreviewBundle = { forms: {}, flows: {}, views: {}, strings: {}, declarations: {} };
    const fams: Record<DefinitionKind, RefOption[]> = { form: [], flow: [], job_schema: [], view: [], content: [], app: [] };
    const appPages = new Map<string, RefOption>();
    let jobSchemaGlobal: unknown;
    let jobSchemaBank: unknown;
    const globalStrings: Record<string, string> = {};
    const bankStrings: Record<string, string> = {};
    for (const f of [...inScope].sort((a, b) => a.key.localeCompare(b.key))) {
      fams[f.kind].push({ key: f.key, title: f.title });
      const def = byFamily.get(f.id);
      if (!def) continue;
      if (f.kind === 'form') (bundle.forms as Record<string, unknown>)[f.key] = def;
      else if (f.kind === 'flow') (bundle.flows as Record<string, unknown>)[f.key] = def;
      else if (f.kind === 'view') (bundle.views as Record<string, unknown>)[f.key] = def;
      else if (f.kind === 'app') {
        for (const [pid, pg] of Object.entries(asObj(def.pages))) appPages.set(pid, { key: pid, title: asStr(asObj(pg).title) || pid });
      } else if (f.kind === 'job_schema') {
        if (f.bank_id) jobSchemaBank = def;
        else jobSchemaGlobal ??= def;
      } else if (f.kind === 'content') {
        const target = f.bank_id ? bankStrings : globalStrings;
        for (const [k, v] of Object.entries(asObj(def.strings))) if (typeof v === 'string') target[k] = v;
      }
    }
    bundle.jobSchema = jobSchemaBank ?? jobSchemaGlobal;
    bundle.strings = { ...globalStrings, ...bankStrings };
    const decl: RefOption[] = [];
    for (const d of declarations.data ?? []) {
      if (bundle.declarations && !bundle.declarations[d.key]) {
        bundle.declarations[d.key] = { title: d.title, text: d.text };
        decl.push({ key: d.key, title: d.title });
      }
    }
    const lookupLists = (lists.data ?? [])
      .filter((l) => l.scope === 'global' || (bankId !== null && l.bank_id === bankId))
      .map((l) => ({ key: l.key, title: l.title }));
    return {
      bundle,
      families: families.data ? fams : EMPTY_FAMILIES,
      declarations: decl,
      lookupLists,
      appPages: [...appPages.values()],
      loading: families.isPending || versions.isPending || (latestIds.length > 0 && defs.isPending),
    };
  }, [defs.data, inScope, declarations.data, lists.data, bankId, families.data, families.isPending, versions.isPending, latestIds.length, defs.isPending]);
}

/** The bundle with the definition being edited merged in (so a view's own draft is what an app page previews, etc.). */
export function withDraft(bundle: PreviewBundle, kind: DefinitionKind, key: string, definition: unknown): PreviewBundle {
  if (!definition) return bundle;
  switch (kind) {
    case 'form':
      return { ...bundle, forms: { ...bundle.forms, [key]: definition } };
    case 'flow':
      return { ...bundle, flows: { ...bundle.flows, [key]: definition } };
    case 'view':
      return { ...bundle, views: { ...bundle.views, [key]: definition } };
    case 'job_schema':
      return { ...bundle, jobSchema: definition };
    case 'content': {
      const strings: Record<string, string> = { ...bundle.strings };
      for (const [k, v] of Object.entries(asObj(asObj(definition).strings))) if (typeof v === 'string') strings[k] = v;
      return { ...bundle, strings };
    }
    default:
      return bundle;
  }
}

/** Sections of a form document as {key, title}. */
export function formSections(form: unknown): RefOption[] {
  return asArr(asObj(form).sections).map((s) => ({ key: asStr(asObj(s).key), title: asStr(asObj(s).title) || asStr(asObj(s).key) }));
}
