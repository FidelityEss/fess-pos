'use client';

// Interactive answer state for a previewed form (T3-23). Every change re-resolves the form through the shared engine
// (visibility, required, computed values, dynamic props, filtered options), and "Next" / "Submit" run the engine's
// validateAnswers on the fields of the current sections — the same messages the phone would show.
import { useCallback, useMemo, useState } from 'react';
import {
  type AnswerEntry,
  compileForm,
  componentSpec,
  type EngineJsonValue,
  evaluate,
  type FieldDef,
  type FormDefinition,
  type RawAnswers,
  type ResolveContext,
  type ResolvedForm,
  type ResolveLists,
  resolveForm,
  validateAnswers,
} from '@/lib/engine';
import { isPlainObject } from '@/lib/utils';
import { sentence } from './preview-format';
import type { RiskLevel } from './phone-widgets';

export interface AnswerMeta {
  other_text?: string;
  unknown?: boolean;
  flagged_differs?: boolean;
}

export type ErrorMap = Record<string, string[]>;

export interface RiskHit {
  key: string;
  section: string;
  fieldLabel: string;
  level: RiskLevel;
  label?: string;
}

export interface FormPreviewState {
  form: FormDefinition | null;
  resolved: ResolvedForm | null;
  /** Why the form cannot be resolved (e.g. a rule cycle in a draft). */
  resolveError: string | null;
  answers: Readonly<Record<string, EngineJsonValue>>;
  meta: Readonly<Record<string, AnswerMeta>>;
  errors: ErrorMap;
  setValue: (key: string, value: EngineJsonValue | undefined) => void;
  setMeta: (key: string, patch: Partial<AnswerMeta>) => void;
  reset: () => void;
  /** Validate the fields of these sections (all when omitted); shows and returns their errors. */
  validate: (sectionKeys?: readonly string[]) => ErrorMap;
  clearErrors: () => void;
  defOf: (key: string) => FieldDef | undefined;
  riskFor: (key: string) => { level: RiskLevel; label?: string } | null;
  risks: (sectionKeys?: readonly string[]) => RiskHit[];
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function withoutEmpty(item: unknown): Record<string, AnswerEntry> {
  const out: Record<string, AnswerEntry> = {};
  if (!isPlainObject(item)) return out;
  for (const [k, v] of Object.entries(item)) if (v !== undefined && v !== null) out[k] = { v: v as EngineJsonValue };
  return out;
}

/** The answers map the phone would submit for the current state (entries `{v, …}` for visible input fields). */
function buildEntries(resolved: ResolvedForm, answers: Readonly<Record<string, EngineJsonValue>>, meta: Readonly<Record<string, AnswerMeta>>): Record<string, AnswerEntry> {
  const out: Record<string, AnswerEntry> = {};
  for (const key of resolved.order) {
    const rf = resolved.fields[key];
    if (!rf || !rf.visible) continue;
    const spec = componentSpec(rf.type);
    if (!spec || spec.valueType === 'none') continue;
    const m = meta[key] ?? {};
    if (rf.computed) {
      if (rf.value !== null) out[key] = { v: rf.value, computed: true };
      continue;
    }
    if (rf.type === 'prefilled') {
      if (rf.value !== null) out[key] = { v: rf.value, prefilled: true, ...(m.flagged_differs ? { flagged_differs: true } : {}) };
      continue;
    }
    if (m.unknown) {
      out[key] = { v: null, unknown: true };
      continue;
    }
    const v = answers[key];
    if (v === undefined || v === null) continue;
    if (rf.type === 'repeatable_group' && Array.isArray(v)) {
      out[key] = {
        v: v.map((item, i) => {
          const visible = rf.items?.[i]?.fields ?? {};
          const entries = withoutEmpty(item);
          for (const k of Object.keys(entries)) if (visible[k] && !visible[k].visible) delete entries[k];
          return entries as unknown as EngineJsonValue;
        }),
      };
      continue;
    }
    out[key] = { v, ...(m.other_text !== undefined ? { other_text: m.other_text } : {}) };
  }
  return out;
}

function prettyError(path: string, msg: string, labelOf: (key: string) => string | undefined): string {
  const m = /^[^[]+\[(\d+)\]\.(.+)$/.exec(path);
  if (!m) return sentence(msg);
  const child = m[2] ?? '';
  return `Item ${Number(m[1]) + 1} · ${labelOf(child) ?? child}: ${sentence(msg)}`;
}

export function useFormPreviewState(form: FormDefinition | null, context: ResolveContext, lists: ResolveLists): FormPreviewState {
  const [answers, setAnswers] = useState<Record<string, EngineJsonValue>>({});
  const [meta, setMetaMap] = useState<Record<string, AnswerMeta>>({});
  const [errors, setErrors] = useState<ErrorMap>({});

  const compiled = useMemo(() => {
    if (!form) return { value: null, error: null };
    try {
      return { value: compileForm(form), error: null };
    } catch (e) {
      return { value: null, error: message(e) };
    }
  }, [form]);

  const resolution = useMemo(() => {
    if (!form || !compiled.value) return { resolved: null, error: compiled.error };
    try {
      return { resolved: resolveForm(form, context, answers as RawAnswers, lists), error: null };
    } catch (e) {
      return { resolved: null, error: message(e) };
    }
  }, [form, compiled, context, answers, lists]);

  const defOf = useCallback((key: string) => compiled.value?.byKey.get(key)?.def, [compiled]);

  const childLabel = useCallback(
    (key: string): string | undefined => {
      for (const f of compiled.value?.fields ?? []) {
        for (const c of f.def.fields ?? []) if (c.key === key && typeof c.label === 'string') return c.label;
      }
      return undefined;
    },
    [compiled],
  );

  const setValue = useCallback((key: string, value: EngineJsonValue | undefined) => {
    setAnswers((a) => {
      const next = { ...a };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }, []);

  const setMeta = useCallback((key: string, patch: Partial<AnswerMeta>) => {
    setMetaMap((m) => ({ ...m, [key]: { ...m[key], ...patch } }));
  }, []);

  const reset = useCallback(() => {
    setAnswers({});
    setMetaMap({});
    setErrors({});
  }, []);

  const clearErrors = useCallback(() => setErrors({}), []);

  const { resolved } = resolution;

  const validate = useCallback(
    (sectionKeys?: readonly string[]): ErrorMap => {
      if (!form || !resolved || !compiled.value) return {};
      const byKey = compiled.value.byKey;
      const map: ErrorMap = {};
      let result;
      try {
        result = validateAnswers(form, buildEntries(resolved, answers, meta), context, lists);
      } catch (e) {
        map[''] = [sentence(message(e))];
        setErrors(map);
        return map;
      }
      for (const err of result.errors) {
        const root = err.field_key.split('[')[0] ?? err.field_key;
        const section = byKey.get(root)?.section;
        if (sectionKeys && (!section || !sectionKeys.includes(section))) continue;
        (map[root] ??= []).push(prettyError(err.field_key, err.message, childLabel));
      }
      setErrors(map);
      return map;
    },
    [form, resolved, compiled, answers, meta, context, lists, childLabel],
  );

  const riskFor = useCallback(
    (key: string) => {
      const def = defOf(key);
      const rf = resolved?.fields[key];
      if (!def?.risk_indicator || !rf?.visible || !resolved) return null;
      const ri = def.risk_indicator;
      try {
        const v = typeof ri.when === 'boolean' ? ri.when : evaluate(ri.when, resolved.data, resolved.env);
        return v === true ? { level: ri.level, label: typeof ri.label === 'string' ? ri.label : undefined } : null;
      } catch {
        return null;
      }
    },
    [defOf, resolved],
  );

  const risks = useCallback(
    (sectionKeys?: readonly string[]): RiskHit[] => {
      if (!resolved || !compiled.value) return [];
      const out: RiskHit[] = [];
      for (const f of compiled.value.fields) {
        if (sectionKeys && !sectionKeys.includes(f.section)) continue;
        const hit = riskFor(f.def.key);
        if (hit) out.push({ key: f.def.key, section: f.section, fieldLabel: resolved.fields[f.def.key]?.label ?? f.def.key, ...hit });
      }
      return out;
    },
    [resolved, compiled, riskFor],
  );

  return { form, resolved, resolveError: resolution.error, answers, meta, errors, setValue, setMeta, reset, validate, clearErrors, defOf, riskFor, risks };
}
