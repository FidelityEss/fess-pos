'use client';

// "Publish a new version" editor for a drop-down list: an editable table of stored value / what agents see rows (add,
// remove, reorder, paste straight from a spreadsheet), with optional extra details per choice as named fields. Raw JSON
// is an Advanced option. Values must be non-empty and unique; the server hashes the items (JCS) and stores an immutable
// version.
import { ArrowDown, ArrowUp, ClipboardPaste, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { type ClipboardEvent, type FormEvent, Fragment, useState } from 'react';
import { newRowId } from '@/components/admin/form-helpers';
import { ObjectEditor, type ObjectEditorState, objectEditorStateFrom, objectEditorStateToObject } from '@/components/admin/object-editor';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { JsonEditor, parseJsonText, stringifyJson } from '@/components/json-editor';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { useMutationWithToast } from '@/lib/mutations';
import { useIsAdvanced } from '@/lib/preferences';
import { lookupListVersionSchema } from '@/lib/schemas';
import type { JsonObject, LookupItem, ValidationIssue } from '@/lib/types';
import { cn, isPlainObject } from '@/lib/utils';

interface ItemRow {
  id: string;
  value: string;
  label: string;
  /** Optional extra details (the item's `meta`). */
  meta: ObjectEditorState;
  metaOpen: boolean;
}

type RowErrors = Record<string, { value?: string; label?: string; meta?: string }>;

const emptyRow = (value = '', label = ''): ItemRow => ({ id: newRowId('item'), value, label, meta: objectEditorStateFrom({}), metaOpen: false });

function rowsFromItems(items: LookupItem[]): ItemRow[] {
  return items.map((it) => ({ ...emptyRow(it.value, it.label), meta: objectEditorStateFrom(it.meta ?? {}) }));
}

function metaCount(r: ItemRow): number {
  return r.meta.mode === 'rows' ? r.meta.rows.filter((x) => x.key.trim()).length : Object.keys(parseObject(r.meta.text)).length;
}

function parseObject(text: string): JsonObject {
  const p = parseJsonText(text || '{}');
  return p.ok && isPlainObject(p.value) ? p.value : {};
}

function itemsFromRows(rows: ItemRow[]): { items: LookupItem[]; errors: RowErrors } {
  const errors: RowErrors = {};
  const items: LookupItem[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const value = r.value.trim();
    const label = r.label.trim();
    if (!value && !label && metaCount(r) === 0) continue;
    const e: { value?: string; label?: string; meta?: string } = {};
    if (!value) e.value = 'Enter a stored value';
    else if (seen.has(value)) e.value = `“${value}” is used twice. Each stored value must be different.`;
    if (!label) e.label = 'Enter what agents see';
    const meta = objectEditorStateToObject(r.meta, { label: 'Extra details' });
    if (!meta.ok) e.meta = meta.message;
    if (value) seen.add(value);
    if (Object.keys(e).length > 0) errors[r.id] = e;
    items.push(meta.ok && Object.keys(meta.value).length > 0 ? { value, label, meta: meta.value } : { value, label });
  }
  return { items, errors };
}

function itemsFromJson(text: string): { items: LookupItem[] | null; error: string | null; issues: ValidationIssue[] } {
  const r = parseJsonText(text);
  if (!r.ok) return { items: null, error: r.error.message, issues: [] };
  if (!Array.isArray(r.value)) return { items: null, error: 'Must be a JSON array of items like [{"value": "…", "label": "…"}]', issues: [] };
  const extra = r.value.findIndex((v) => isPlainObject(v) && Object.keys(v).some((k) => k !== 'value' && k !== 'label' && k !== 'meta'));
  if (extra >= 0) return { items: null, error: `Item ${extra + 1} has keys other than value, label and meta`, issues: [] };
  const trimmed = r.value.map((v) =>
    isPlainObject(v)
      ? { ...v, value: typeof v.value === 'string' ? v.value.trim() : v.value, label: typeof v.label === 'string' ? v.label.trim() : v.label }
      : v,
  );
  const parsed = lookupListVersionSchema.safeParse({ items: trimmed });
  if (!parsed.success) {
    return { items: null, error: 'Some choices aren’t valid', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  }
  if (parsed.data.items.length === 0) return { items: null, error: 'Add at least one choice', issues: [] };
  return { items: parsed.data.items, error: null, issues: [] };
}

/** Spreadsheet text → [value, label] pairs. Tab-separated (as copied from Excel / Sheets), else comma or semicolon. */
export function parseSpreadsheet(text: string, skipHeader: boolean): [string, string][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const out: [string, string][] = [];
  for (const line of skipHeader ? lines.slice(1) : lines) {
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const [first = '', ...rest] = line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
    const second = rest.join(sep === '\t' ? ' ' : `${sep} `).trim();
    out.push([first, second || first]);
  }
  return out;
}

export function VersionEditorDialog({
  listId,
  listTitle,
  nextVersion,
  initialItems,
  open,
  onOpenChange,
}: {
  listId: string;
  listTitle: string;
  nextVersion: number;
  initialItems: LookupItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        {open ? <VersionEditor listId={listId} listTitle={listTitle} nextVersion={nextVersion} initialItems={initialItems} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function VersionEditor({
  listId,
  listTitle,
  nextVersion,
  initialItems,
  onDone,
}: {
  listId: string;
  listTitle: string;
  nextVersion: number;
  initialItems: LookupItem[];
  onDone: () => void;
}) {
  const advanced = useIsAdvanced();
  const [mode, setMode] = useState<'table' | 'json'>('table');
  const [rows, setRows] = useState<ItemRow[]>(() => (initialItems.length > 0 ? rowsFromItems(initialItems) : [emptyRow()]));
  const [text, setText] = useState('');
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [jsonIssues, setJsonIssues] = useState<ValidationIssue[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteHeader, setPasteHeader] = useState(false);
  const publish = useMutationWithToast({
    mutationFn: (items: LookupItem[]) => adminApi.lookupLists.publishVersion(listId, { items }),
    invalidate: [['lookup_lists']],
    toastErrors: false,
    successMessage: (v) => `Version ${v.version} published.`,
    onSuccess: () => onDone(),
  });

  function toJson() {
    const r = itemsFromRows(rows);
    if (Object.keys(r.errors).length > 0) {
      setRowErrors(r.errors);
      setGeneral('Fix the highlighted rows before switching to JSON.');
      return;
    }
    setText(stringifyJson(r.items));
    setRowErrors({});
    setGeneral(null);
    setMode('json');
  }
  function toTable() {
    const r = itemsFromJson(text);
    if (!r.items) {
      setGeneral(r.error);
      setJsonIssues(r.issues);
      return;
    }
    setRows(r.items.length > 0 ? rowsFromItems(r.items) : [emptyRow()]);
    setJsonIssues([]);
    setGeneral(null);
    setMode('table');
  }
  function setRow(rowId: string, patch: Partial<ItemRow>) {
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
    // An edited row's errors are stale until the next validation (on publish or switching to JSON).
    if ('value' in patch || 'label' in patch || 'meta' in patch) {
      setRowErrors((errs) => {
        if (!errs[rowId]) return errs;
        const next = { ...errs };
        delete next[rowId];
        return next;
      });
    }
  }
  function move(index: number, delta: -1 | 1) {
    setRows((rs) => {
      const a = rs[index];
      const b = rs[index + delta];
      if (!a || !b) return rs;
      const next = [...rs];
      next[index] = b;
      next[index + delta] = a;
      return next;
    });
  }
  /** Insert pasted spreadsheet rows at `index` (replacing that row when it is blank). */
  function insertPairs(pairs: [string, string][], index: number) {
    if (pairs.length === 0) return;
    setRows((rs) => {
      const target = rs[index];
      const replace = target && !target.value.trim() && !target.label.trim() ? 1 : 0;
      const pasted = pairs.map(([v, l]) => emptyRow(v, l));
      const next = [...rs.slice(0, index + (replace ? 0 : 1)), ...pasted, ...rs.slice(index + 1)];
      // drop blank rows left over at the end
      return next.filter((r, i) => i < next.length - 1 || r.value.trim() || r.label.trim() || next.length === 1);
    });
  }
  function onValuePaste(e: ClipboardEvent<HTMLInputElement>, index: number) {
    const data = e.clipboardData.getData('text');
    if (!data.includes('\n') && !data.includes('\t')) return;
    e.preventDefault();
    insertPairs(parseSpreadsheet(data, false), index);
  }
  function applyPaste(how: 'append' | 'replace') {
    const pairs = parseSpreadsheet(pasteText, pasteHeader);
    if (pairs.length === 0) return;
    const pasted = pairs.map(([v, l]) => emptyRow(v, l));
    setRows((rs) => (how === 'replace' ? pasted : [...rs.filter((r) => r.value.trim() || r.label.trim() || metaCount(r) > 0), ...pasted]));
    setPasteText('');
    setPasteOpen(false);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    let items: LookupItem[];
    if (mode === 'table') {
      const r = itemsFromRows(rows);
      setRowErrors(r.errors);
      if (Object.keys(r.errors).length > 0) {
        setGeneral('Check the highlighted rows and try again.');
        return;
      }
      if (r.items.length === 0) {
        setGeneral('Add at least one choice.');
        return;
      }
      items = r.items;
    } else {
      const r = itemsFromJson(text);
      setJsonIssues(r.issues);
      if (!r.items) {
        setGeneral(r.error);
        return;
      }
      items = r.items;
    }
    setGeneral(null);
    publish.mutate(items);
  }

  const filled = rows.filter((r) => r.value.trim() || r.label.trim()).length;
  const pastePreview = pasteText.trim() ? parseSpreadsheet(pasteText, pasteHeader) : [];

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>
          Publish version {nextVersion} of {listTitle}
        </DialogTitle>
        <DialogDescription>Once published, a version can’t be changed. Questions already using an earlier version keep it; this one becomes the latest.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2">
        {advanced || mode === 'json' ? (
          <div className="inline-flex rounded-md border bg-muted p-0.5 text-sm" role="tablist" aria-label="Editor">
            <button type="button" role="tab" aria-selected={mode === 'table'} onClick={() => (mode === 'json' ? toTable() : undefined)} className={cn('rounded px-3 py-1', mode === 'table' ? 'bg-card font-medium ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>
              Table
            </button>
            <button type="button" role="tab" aria-selected={mode === 'json'} onClick={() => (mode === 'table' ? toJson() : undefined)} className={cn('rounded px-3 py-1', mode === 'json' ? 'bg-card font-medium ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>
              JSON
            </button>
          </div>
        ) : null}
        {mode === 'table' ? (
          <>
            <span className="text-sm text-muted-foreground">
              {filled} choice{filled === 1 ? '' : 's'}. Empty rows are skipped. Tip: you can paste two columns from a spreadsheet (stored value, then what
              agents see) into any stored value box.
            </span>
            <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => setPasteOpen((o) => !o)} aria-expanded={pasteOpen}>
              <ClipboardPaste /> Paste from a spreadsheet
            </Button>
          </>
        ) : null}
      </div>

      {mode === 'table' && pasteOpen ? (
        <div className="grid gap-3 rounded-md border p-4">
          <p className="text-sm">
            Copy two columns from Excel or Google Sheets, <strong>stored value</strong> then <strong>what agents see</strong>, and paste them below, one
            choice per line. If you paste one column, it’s used for both.
          </p>
          <Textarea rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'retail\tRetail shop\nfood\tRestaurant or takeaway'} className="font-mono text-sm" aria-label="Spreadsheet rows" />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={pasteHeader} onCheckedChange={(v) => setPasteHeader(v === true)} /> The first line is a header row
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {pastePreview.length} choice{pastePreview.length === 1 ? '' : 's'} found
            </span>
            <Button type="button" size="sm" variant="outline" className="ml-auto" disabled={pastePreview.length === 0} onClick={() => applyPaste('append')}>
              Add to the end
            </Button>
            <Button type="button" size="sm" disabled={pastePreview.length === 0} onClick={() => applyPaste('replace')}>
              Replace all choices
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'table' ? (
        <div className="max-h-[55vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Stored value *</TableHead>
                <TableHead>What agents see *</TableHead>
                <TableHead>Extra details</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const err = rowErrors[r.id];
                const n = metaCount(r);
                return (
                  <Fragment key={r.id}>
                    <TableRow className="align-top">
                      <TableCell className="pt-4 text-sm tabular-nums text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="min-w-44">
                        <Input value={r.value} onChange={(e) => setRow(r.id, { value: e.target.value })} onPaste={(e) => onValuePaste(e, i)} className="font-mono" aria-label={`Stored value ${i + 1}`} aria-invalid={!!err?.value || undefined} />
                        {err?.value ? <p className="mt-1 text-sm text-destructive">{err.value}</p> : null}
                      </TableCell>
                      <TableCell className="min-w-56">
                        <Input value={r.label} onChange={(e) => setRow(r.id, { label: e.target.value })} aria-label={`What agents see ${i + 1}`} aria-invalid={!!err?.label || undefined} />
                        {err?.label ? <p className="mt-1 text-sm text-destructive">{err.label}</p> : null}
                      </TableCell>
                      <TableCell>
                        <Button type="button" size="sm" variant={r.metaOpen ? 'secondary' : 'ghost'} onClick={() => setRow(r.id, { metaOpen: !r.metaOpen })} aria-expanded={r.metaOpen} className={cn(err?.meta && 'text-destructive')}>
                          <SlidersHorizontal /> {n ? `${n} detail${n === 1 ? '' : 's'}` : 'Add'}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-0.5">
                          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Move choice ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                            <ArrowUp />
                          </Button>
                          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Move choice ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                            <ArrowDown />
                          </Button>
                          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove choice ${i + 1}`} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.id !== r.id) : [emptyRow()]))}>
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {r.metaOpen ? (
                      <TableRow>
                        <TableCell />
                        <TableCell colSpan={4} className="pb-4">
                          <p className="mb-2 text-sm text-muted-foreground">Extra details kept with “{r.label || r.value || `choice ${i + 1}`}” (optional, such as a group).</p>
                          <ObjectEditor state={r.meta} onChange={(meta) => setRow(r.id, { meta })} label="Extra details" keyLabel="Detail" keyPlaceholder="For example, group" addLabel="Add a detail" emptyText="No extra details." error={err?.meta} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <JsonEditor value={text} onChange={setText} rows={18} serverErrors={jsonIssues} />
      )}
      {mode === 'table' ? (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
            <Plus /> Add a choice
          </Button>
        </div>
      ) : null}
      {general ? (
        <Alert variant="destructive">
          <AlertDescription>{general}</AlertDescription>
        </Alert>
      ) : null}
      <ApiErrorAlert error={publish.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={publish.isPending}>
          Publish version {nextVersion}
        </Button>
      </DialogFooter>
    </form>
  );
}
