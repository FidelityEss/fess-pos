'use client';

// Typed key/value rows for a JSON object (T2-25): each row is a name and a text / number / yes-no value. Nested values
// (objects, lists) are kept as they are — shown readably in Basic view and editable as JSON only in Advanced view — so
// nothing is ever dropped. Advanced view also offers "Edit as JSON" for the whole object.
import { Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { JsonEditor, parseJsonText, stringifyJson } from '@/components/json-editor';
import { StructuredView } from '@/components/structured-view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useIsAdvanced } from '@/lib/preferences';
import type { JsonObject } from '@/lib/types';
import { cn, isPlainObject } from '@/lib/utils';
import { newRowId, type Parsed } from './form-helpers';

export type KvType = 'text' | 'number' | 'boolean' | 'json';

export interface KvRow {
  id: string;
  key: string;
  type: KvType;
  /** Text / number / JSON text. */
  text: string;
  bool: boolean;
}

export interface ObjectEditorState {
  mode: 'rows' | 'json';
  rows: KvRow[];
  /** JSON text (json mode). */
  text: string;
}

const TYPE_LABEL: Record<KvType, string> = { text: 'Text', number: 'Number', boolean: 'Yes / No', json: 'Structured (JSON)' };

function typeOf(v: unknown): KvType {
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'text';
  return 'json';
}

/** One row per key, typed from the value. */
export function kvRowsFrom(obj: JsonObject | null | undefined): KvRow[] {
  return Object.entries(obj ?? {}).map(([key, v]) => {
    const type = typeOf(v);
    return {
      id: newRowId('kv'),
      key,
      type,
      text: type === 'json' ? stringifyJson(v) : type === 'boolean' ? '' : String(v),
      bool: v === true,
    };
  });
}

export function emptyKvRow(type: KvType = 'text'): KvRow {
  return { id: newRowId('kv'), key: '', type, text: '', bool: false };
}

export function objectEditorStateFrom(obj: JsonObject | null | undefined): ObjectEditorState {
  return { mode: 'rows', rows: kvRowsFrom(obj), text: stringifyJson(obj ?? {}) };
}

export interface KvParseOptions {
  /** Used in messages, e.g. "Attributes". */
  label: string;
  /** Extra per-value check; return a message to reject. */
  validate?: (key: string, value: unknown) => string | null;
}

/** Rows → object, or a message saying what to fix. Rows with neither a name nor a value are ignored. */
export function kvRowsToObject(rows: KvRow[], { label, validate }: KvParseOptions): Parsed<JsonObject> {
  const out: JsonObject = {};
  for (const r of rows) {
    const key = r.key.trim();
    if (!key && !r.text.trim()) continue;
    if (!key) return { ok: false, message: `${label}: every row needs a name` };
    if (Object.prototype.hasOwnProperty.call(out, key)) return { ok: false, message: `${label}: "${key}" appears twice` };
    let value: unknown;
    switch (r.type) {
      case 'text':
        value = r.text;
        break;
      case 'boolean':
        value = r.bool;
        break;
      case 'number': {
        const t = r.text.trim();
        if (!t || !Number.isFinite(Number(t))) return { ok: false, message: `${label}: "${key}" needs a number` };
        value = Number(t);
        break;
      }
      case 'json': {
        const p = parseJsonText(r.text);
        if (!p.ok) return { ok: false, message: `${label}: "${key}" is not valid JSON — ${p.error.message}` };
        value = p.value;
        break;
      }
    }
    const problem = validate?.(key, value);
    if (problem) return { ok: false, message: `${label}: ${problem}` };
    out[key] = value;
  }
  return { ok: true, value: out };
}

/** The object the editor describes (either mode), or a message. */
export function objectEditorStateToObject(state: ObjectEditorState, opts: KvParseOptions): Parsed<JsonObject> {
  if (state.mode === 'rows') return kvRowsToObject(state.rows, opts);
  if (!state.text.trim()) return { ok: true, value: {} };
  const r = parseJsonText(state.text, { requireObject: true });
  if (!r.ok) return { ok: false, message: `${opts.label}: ${r.error.message}` };
  if (!isPlainObject(r.value)) return { ok: false, message: `${opts.label} must be an object` };
  // Run the per-value check in JSON mode too.
  for (const [k, v] of Object.entries(r.value)) {
    const problem = opts.validate?.(k, v);
    if (problem) return { ok: false, message: `${opts.label}: ${problem}` };
  }
  return { ok: true, value: r.value };
}

function convertRow(r: KvRow, type: KvType): KvRow {
  if (type === r.type) return r;
  if (type === 'boolean') return { ...r, type, bool: r.text.trim().toLowerCase() === 'true' || r.text.trim().toLowerCase() === 'yes' };
  if (r.type === 'boolean') return { ...r, type, text: type === 'json' ? String(r.bool) : r.bool ? 'Yes' : '' };
  return { ...r, type };
}

export interface ObjectEditorProps {
  state: ObjectEditorState;
  onChange: (next: ObjectEditorState) => void;
  /** Used in error messages when switching modes. */
  label?: string;
  disabled?: boolean;
  error?: string | null;
  id?: string;
  /** Every value has this type (hides the type picker), e.g. 'number' for version maps. */
  fixedType?: Exclude<KvType, 'json'>;
  keyLabel?: string;
  valueLabel?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  emptyText?: string;
  /** Show the name in a monospace font (technical keys). Default true. */
  keyMono?: boolean;
  /** Offer "Edit as JSON" in Advanced view (default true). */
  allowJson?: boolean;
}

/** Key/value rows editor with an Advanced-only JSON mode. */
export function ObjectEditor({
  state,
  onChange,
  label = 'Values',
  disabled = false,
  error,
  id,
  fixedType,
  keyLabel = 'Name',
  valueLabel = 'Value',
  keyPlaceholder,
  valuePlaceholder,
  addLabel = 'Add a row',
  emptyText = 'Nothing set.',
  keyMono = true,
  allowJson = true,
}: ObjectEditorProps) {
  const advanced = useIsAdvanced();
  const uid = useId();
  const rowsParse = state.mode === 'rows' ? kvRowsToObject(state.rows, { label }) : null;
  const jsonParse = state.mode === 'json' ? parseJsonText(state.text || '{}', { requireObject: true }) : null;

  function setRow(rowId: string, patch: Partial<KvRow>) {
    onChange({ ...state, rows: state.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)) });
  }
  function toJson() {
    if (!rowsParse?.ok) return;
    onChange({ ...state, mode: 'json', text: stringifyJson(rowsParse.value) });
  }
  function toRows() {
    if (!jsonParse?.ok || !isPlainObject(jsonParse.value)) return;
    onChange({ ...state, mode: 'rows', rows: kvRowsFrom(jsonParse.value) });
  }

  const showModeSwitch = allowJson && (advanced || state.mode === 'json');
  const grid = fixedType ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]' : 'sm:grid-cols-[minmax(0,1fr)_9.5rem_minmax(0,1.4fr)_auto]';

  return (
    <div className="grid gap-3" id={id}>
      {showModeSwitch ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border bg-muted p-0.5 text-sm" role="tablist" aria-label={`${label} editor`}>
            <button
              type="button"
              role="tab"
              aria-selected={state.mode === 'rows'}
              disabled={disabled || (state.mode === 'json' && !jsonParse?.ok)}
              onClick={toRows}
              className={cn('rounded px-3 py-1', state.mode === 'rows' ? 'bg-card font-medium ring-1 ring-border' : 'text-muted-foreground hover:text-foreground disabled:opacity-50')}
            >
              Fields
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={state.mode === 'json'}
              disabled={disabled || (state.mode === 'rows' && !rowsParse?.ok)}
              onClick={toJson}
              className={cn('rounded px-3 py-1', state.mode === 'json' ? 'bg-card font-medium ring-1 ring-border' : 'text-muted-foreground hover:text-foreground disabled:opacity-50')}
            >
              JSON
            </button>
          </div>
          {state.mode === 'rows' && rowsParse && !rowsParse.ok ? <span className="text-sm text-muted-foreground">Fix the rows to switch to JSON.</span> : null}
          {state.mode === 'json' && jsonParse && !jsonParse.ok ? <span className="text-sm text-muted-foreground">Fix the JSON to switch back to fields.</span> : null}
        </div>
      ) : null}

      {state.mode === 'json' ? (
        <JsonEditor value={state.text} onChange={(text) => onChange({ ...state, text })} requireObject rows={8} readOnly={disabled} />
      ) : (
        <div className="grid gap-2">
          {state.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            <div className={cn('hidden gap-2 px-0.5 text-sm font-medium text-muted-foreground sm:grid', grid)}>
              <span>{keyLabel}</span>
              {fixedType ? null : <span>Type</span>}
              <span>{valueLabel}</span>
              <span className="w-9" />
            </div>
          )}
          {state.rows.map((r, i) => (
            <div key={r.id} className={cn('grid items-start gap-2 rounded-md border p-2 sm:border-0 sm:p-0', grid)}>
              <Input
                value={r.key}
                onChange={(e) => setRow(r.id, { key: e.target.value })}
                placeholder={keyPlaceholder}
                aria-label={`${keyLabel} ${i + 1}`}
                disabled={disabled}
                className={keyMono ? 'font-mono' : undefined}
              />
              {fixedType ? null : (
                <Select value={r.type} onValueChange={(v) => setRow(r.id, convertRow(r, v as KvType))} disabled={disabled}>
                  <SelectTrigger aria-label={`Type of ${r.key || `row ${i + 1}`}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['text', 'number', 'boolean'] as const).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                    {advanced || r.type === 'json' ? <SelectItem value="json">{advanced ? TYPE_LABEL.json : 'Group of values'}</SelectItem> : null}
                  </SelectContent>
                </Select>
              )}
              <ValueControl row={r} fixedType={fixedType} onChange={(patch) => setRow(r.id, patch)} disabled={disabled} placeholder={valuePlaceholder} ariaLabel={`${valueLabel} for ${r.key || `row ${i + 1}`}`} advanced={advanced} uid={`${uid}-${r.id}`} />
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${r.key || `row ${i + 1}`}`} disabled={disabled} onClick={() => onChange({ ...state, rows: state.rows.filter((x) => x.id !== r.id) })}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <div>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange({ ...state, rows: [...state.rows, emptyKvRow(fixedType ?? 'text')] })}>
              <Plus /> {addLabel}
            </Button>
          </div>
        </div>
      )}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ValueControl({
  row,
  fixedType,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
  advanced,
  uid,
}: {
  row: KvRow;
  fixedType?: KvType;
  onChange: (patch: Partial<KvRow>) => void;
  disabled: boolean;
  placeholder?: string;
  ariaLabel: string;
  advanced: boolean;
  uid: string;
}) {
  const type = fixedType ?? row.type;
  if (type === 'boolean') {
    return (
      <label htmlFor={uid} className="flex h-10 items-center gap-2 text-sm">
        <Switch id={uid} checked={row.bool} onCheckedChange={(v) => onChange({ bool: v })} disabled={disabled} aria-label={ariaLabel} />
        {row.bool ? 'Yes' : 'No'}
      </label>
    );
  }
  if (type === 'number') {
    return <Input type="number" inputMode="decimal" step="any" value={row.text} onChange={(e) => onChange({ text: e.target.value })} placeholder={placeholder} aria-label={ariaLabel} disabled={disabled} />;
  }
  if (type === 'json') {
    if (!advanced) {
      const parsed = parseJsonText(row.text);
      return (
        <div className="rounded-md border px-3 py-2">
          {parsed.ok ? <StructuredView value={parsed.value} expandDepth={1} /> : <span className="text-sm text-muted-foreground">Group of values</span>}
          <p className="mt-1 text-sm text-muted-foreground">Kept as it is. Switch to Advanced view to change it.</p>
        </div>
      );
    }
    return <Textarea rows={3} value={row.text} onChange={(e) => onChange({ text: e.target.value })} aria-label={ariaLabel} disabled={disabled} className="font-mono text-sm" spellCheck={false} />;
  }
  return <Input value={row.text} onChange={(e) => onChange({ text: e.target.value })} placeholder={placeholder} aria-label={ariaLabel} disabled={disabled} />;
}
