'use client';

// Amend one answer of an inspection (docs/05: amendments are immutable; original answers stay untouched).
// The new value is entered with an input that matches the field in the pinned form definition — text, number, yes/no,
// a choice from the field's options, a date (T2-25). Structured answers (addresses, photo lists…) can only be amended
// as JSON, in Advanced view.
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { FormField } from '@/components/form-field';
import { ActionDialog } from '@/components/jobs/job-bits';
import { type FormFieldDef, invalidateJob } from '@/components/jobs/job-data';
import { StructuredView } from '@/components/structured-view';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { useMutationWithToast } from '@/lib/mutations';
import { useIsAdvanced } from '@/lib/preferences';
import type { AmendmentBody } from '@/lib/schemas';
import type { Amendment } from '@/lib/types';
import { cn } from '@/lib/utils';

type Kind = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'multi' | 'date' | 'json';

const NUMBER_TYPES = ['number', 'integer', 'decimal', 'percentage', 'currency', 'rating', 'slider'];
const BOOL_TYPES = ['boolean', 'yes_no', 'toggle', 'switch'];
const MULTI_TYPES = ['multi_select', 'checkbox_group'];
const LONG_TEXT_TYPES = ['textarea', 'long_text', 'paragraph_input'];

/** The input to use for a field, from its definition type, its options and the current value. */
function kindFor(field: FormFieldDef | null | undefined, current: unknown): Kind {
  const type = field?.type ?? '';
  const options = field?.options ?? [];
  const isScalarList = Array.isArray(current) && current.every((x) => typeof x === 'string' || typeof x === 'number');
  if (options.length > 0) {
    if (MULTI_TYPES.includes(type) || isScalarList) return 'multi';
    if (current === null || current === undefined || typeof current === 'string' || typeof current === 'number') return 'select';
  }
  if (BOOL_TYPES.includes(type) || typeof current === 'boolean') return 'boolean';
  if (NUMBER_TYPES.includes(type) || typeof current === 'number') return 'number';
  if (type === 'date' && (typeof current === 'string' || current == null)) return 'date';
  if (current === null || current === undefined || typeof current === 'string') {
    return LONG_TEXT_TYPES.includes(type) || (typeof current === 'string' && (current.length > 80 || current.includes('\n'))) ? 'textarea' : 'text';
  }
  return 'json';
}

/** Readable rendering of the current value (option labels, Yes/No, lists). */
function CurrentValue({ field, value }: { field: FormFieldDef | null | undefined; value: unknown }) {
  const label = (x: unknown) => field?.options.find((o) => o.value === String(x))?.label ?? String(x);
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">No answer</span>;
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>;
  if (typeof value === 'string' || typeof value === 'number') return <span className="whitespace-pre-wrap break-words">{label(value)}</span>;
  if (Array.isArray(value) && value.every((x) => typeof x === 'string' || typeof x === 'number')) return <>{value.map(label).join(', ') || 'None'}</>;
  return <StructuredView value={value} expandDepth={1} />;
}

export function AmendDialog({
  jobId,
  inspectionId,
  fieldKey,
  fieldLabel,
  field,
  currentValue,
  onClose,
}: {
  jobId: string;
  inspectionId: string;
  fieldKey: string;
  fieldLabel: string;
  /** The field's definition from the pinned form version, when known. */
  field?: FormFieldDef | null;
  currentValue: unknown;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const advanced = useIsAdvanced();
  const uid = useId();
  const kind = kindFor(field, currentValue);
  const [asJson, setAsJson] = useState(kind === 'json');
  const [text, setText] = useState(() => (typeof currentValue === 'string' || typeof currentValue === 'number' ? String(currentValue) : ''));
  const [bool, setBool] = useState<boolean | null>(typeof currentValue === 'boolean' ? currentValue : null);
  const [multi, setMulti] = useState<string[]>(() => (Array.isArray(currentValue) ? currentValue.map(String) : []));
  const [jsonText, setJsonText] = useState(() => JSON.stringify(currentValue ?? null, null, 2) ?? '');
  const [justification, setJustification] = useState('');
  const options = field?.options ?? [];
  const jsonMode = asJson && advanced;

  let parsed: { ok: true; value: unknown } | { ok: false; error: string | null };
  if (jsonMode) {
    try {
      parsed = { ok: true, value: JSON.parse(jsonText) as unknown };
    } catch (e) {
      parsed = { ok: false, error: `Not valid JSON: ${e instanceof Error ? e.message : 'invalid'}` };
    }
  } else {
    switch (kind) {
      case 'number': {
        const t = text.trim();
        parsed = t && Number.isFinite(Number(t)) ? { ok: true, value: Number(t) } : { ok: false, error: t ? 'Enter a number' : null };
        break;
      }
      case 'boolean':
        parsed = bool === null ? { ok: false, error: null } : { ok: true, value: bool };
        break;
      case 'select':
        parsed = text ? { ok: true, value: text } : { ok: false, error: null };
        break;
      case 'multi':
        parsed = { ok: true, value: multi };
        break;
      case 'json':
        parsed = { ok: false, error: null };
        break;
      default:
        parsed = { ok: true, value: text };
    }
  }

  const mutation = useMutationWithToast<Amendment, AmendmentBody>({
    mutationFn: (body) => adminApi.inspections.amend(inspectionId, body),
    toastErrors: false,
    successMessage: `Amendment to "${fieldLabel}" recorded`,
    onSuccess: async () => {
      await invalidateJob(queryClient, jobId);
      onClose();
    },
  });

  const valueId = `${uid}-value`;
  let control;
  if (jsonMode) {
    control = <Textarea id={valueId} rows={6} value={jsonText} onChange={(e) => setJsonText(e.target.value)} className="font-mono text-sm" spellCheck={false} />;
  } else if (kind === 'json') {
    control = (
      <Alert variant="info">
        <AlertDescription>
          This answer has a structured value (for example an address or a list of photos). Switch to Advanced view (top right) to amend it as JSON.
        </AlertDescription>
      </Alert>
    );
  } else if (kind === 'number') {
    control = <Input id={valueId} type="number" inputMode="decimal" step="any" value={text} onChange={(e) => setText(e.target.value)} />;
  } else if (kind === 'date') {
    control = <Input id={valueId} type="date" value={text} onChange={(e) => setText(e.target.value)} />;
  } else if (kind === 'textarea') {
    control = <Textarea id={valueId} rows={4} value={text} onChange={(e) => setText(e.target.value)} />;
  } else if (kind === 'boolean') {
    control = (
      <div id={valueId} role="radiogroup" className="inline-flex gap-2">
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={bool === v}
            onClick={() => setBool(v)}
            className={cn('h-10 rounded-md border px-5 text-sm font-medium', bool === v ? 'border-primary bg-primary/10 text-primary' : 'bg-card hover:bg-accent')}
          >
            {v ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    );
  } else if (kind === 'select') {
    const known = options.some((o) => o.value === text);
    control = (
      <Select value={text || undefined} onValueChange={setText}>
        <SelectTrigger id={valueId}>
          <SelectValue placeholder="Choose the correct answer" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
          {text && !known ? <SelectItem value={text}>{text} (current, not in the form)</SelectItem> : null}
        </SelectContent>
      </Select>
    );
  } else if (kind === 'multi') {
    const extra = multi.filter((m) => !options.some((o) => o.value === m));
    control = (
      <div id={valueId} role="group" className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
        {[...options, ...extra.map((v) => ({ value: v, label: `${v} (not in the form)` }))].map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <Checkbox checked={multi.includes(o.value)} onCheckedChange={(v) => setMulti((cur) => (v === true ? [...cur, o.value] : cur.filter((x) => x !== o.value)))} />
            {o.label}
          </label>
        ))}
      </div>
    );
  } else {
    control = <Input id={valueId} value={text} onChange={(e) => setText(e.target.value)} />;
  }

  return (
    <ActionDialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      title={`Amend "${fieldLabel}"`}
      description="The agent's original answer stays untouched. The amendment is recorded alongside it with your name, the time and your justification."
      submitLabel="Record amendment"
      size="lg"
      pending={mutation.isPending}
      error={mutation.error}
      canSubmit={parsed.ok && !!justification.trim()}
      onSubmit={() => parsed.ok && mutation.mutate({ field_key: fieldKey, new_value: parsed.value, justification: justification.trim() })}
    >
      <div className="rounded-md border bg-slate-50 p-3 text-sm">
        <div className="mb-1 text-muted-foreground">
          Current answer
          {advanced ? <code className="ml-1 text-sm">{fieldKey}</code> : null}
        </div>
        <div className="max-h-40 overflow-auto">
          <CurrentValue field={field} value={currentValue} />
        </div>
      </div>
      <FormField
        label="Correct answer"
        htmlFor={valueId}
        required
        error={parsed.ok ? null : parsed.error}
        action={
          advanced ? (
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Checkbox checked={asJson} onCheckedChange={(v) => setAsJson(v === true)} /> Enter as JSON
            </label>
          ) : undefined
        }
        hint={jsonMode ? 'A JSON value: "text", 42, true, ["a","b"], {…}.' : kind === 'multi' ? 'Tick every answer that applies.' : undefined}
      >
        {control}
      </FormField>
      <FormField label="Justification" htmlFor={`${uid}-why`} required hint="Why the recorded answer is wrong and where the correct value comes from.">
        <Textarea id={`${uid}-why`} rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} />
      </FormField>
    </ActionDialog>
  );
}
