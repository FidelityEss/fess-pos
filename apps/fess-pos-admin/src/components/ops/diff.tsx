'use client';

// Local, dependency-free JSON diffing: a side-by-side line diff (LCS) and a field-level (leaf path) diff.
import { ShieldAlert } from 'lucide-react';
import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn, isPlainObject } from '@/lib/utils';
import { compactJson, jsonEqual } from './ops-shared';

export type DiffOp = { type: 'same' | 'del' | 'add'; text: string };

/** Largest middle section (lines × lines) diffed with the O(n·m) LCS table; beyond it, the middle is shown as replaced. */
const MAX_CELLS = 4_000_000;

/** Line diff of two texts (common prefix/suffix trimmed, LCS on the rest). */
export function lineDiff(a: string, b: string): DiffOp[] {
  const A = a.split('\n');
  const B = b.split('\n');
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: DiffOp[] = A.slice(0, start).map((text) => ({ type: 'same', text }));
  const midA = A.slice(start, endA);
  const midB = B.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if (n * m > MAX_CELLS) {
    midA.forEach((text) => ops.push({ type: 'del', text }));
    midB.forEach((text) => ops.push({ type: 'add', text }));
  } else if (n > 0 || m > 0) {
    // lcs[i][j] = LCS length of midA[i:] and midB[j:], stored row-major in a flat array.
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] = midA[i] === midB[j] ? (lcs[(i + 1) * w + j + 1] ?? 0) + 1 : Math.max(lcs[(i + 1) * w + j] ?? 0, lcs[i * w + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({ type: 'same', text: midA[i] ?? '' });
        i++;
        j++;
      } else if ((lcs[(i + 1) * w + j] ?? 0) >= (lcs[i * w + j + 1] ?? 0)) {
        ops.push({ type: 'del', text: midA[i] ?? '' });
        i++;
      } else {
        ops.push({ type: 'add', text: midB[j] ?? '' });
        j++;
      }
    }
    while (i < n) ops.push({ type: 'del', text: midA[i++] ?? '' });
    while (j < m) ops.push({ type: 'add', text: midB[j++] ?? '' });
  }
  A.slice(endA).forEach((text) => ops.push({ type: 'same', text }));
  return ops;
}

interface SideCell {
  no: number;
  text: string;
  type: 'same' | 'del' | 'add';
}
interface SideRow {
  left: SideCell | null;
  right: SideCell | null;
  changed: boolean;
}

/** Pair a diff into side-by-side rows (runs of deletions and additions are aligned). */
function toSideBySide(ops: DiffOp[]): SideRow[] {
  const rows: SideRow[] = [];
  let ln = 1;
  let rn = 1;
  let k = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (!op) break;
    if (op.type === 'same') {
      rows.push({ left: { no: ln++, text: op.text, type: 'same' }, right: { no: rn++, text: op.text, type: 'same' }, changed: false });
      k++;
      continue;
    }
    const dels: string[] = [];
    const adds: string[] = [];
    while (k < ops.length && ops[k]?.type !== 'same') {
      const o = ops[k];
      if (o?.type === 'del') dels.push(o.text);
      else if (o?.type === 'add') adds.push(o.text);
      k++;
    }
    const len = Math.max(dels.length, adds.length);
    for (let x = 0; x < len; x++) {
      const d = dels[x];
      const a = adds[x];
      rows.push({
        left: d !== undefined ? { no: ln++, text: d, type: 'del' } : null,
        right: a !== undefined ? { no: rn++, text: a, type: 'add' } : null,
        changed: true,
      });
    }
  }
  return rows;
}

const CONTEXT = 3;

/** Side-by-side line diff of two JSON values (pretty-printed). Unchanged stretches fold unless "Show all" is on. */
export function LineDiffView({
  before,
  after,
  beforeLabel = 'Before',
  afterLabel = 'After',
  maxHeight = 560,
}: {
  before: unknown;
  after: unknown;
  beforeLabel?: ReactNode;
  afterLabel?: ReactNode;
  maxHeight?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => {
    const a = before === undefined ? '' : (JSON.stringify(before, null, 2) ?? '');
    const b = after === undefined ? '' : (JSON.stringify(after, null, 2) ?? '');
    return toSideBySide(lineDiff(a, b));
  }, [before, after]);
  const changedCount = rows.filter((r) => r.changed).length;

  const visible = useMemo(() => {
    if (showAll) return rows.map((r) => ({ kind: 'row' as const, row: r }));
    const keep = new Array<boolean>(rows.length).fill(false);
    rows.forEach((r, i) => {
      if (!r.changed) return;
      for (let x = Math.max(0, i - CONTEXT); x <= Math.min(rows.length - 1, i + CONTEXT); x++) keep[x] = true;
    });
    const out: ({ kind: 'row'; row: SideRow } | { kind: 'gap'; count: number })[] = [];
    let gap = 0;
    rows.forEach((r, i) => {
      if (keep[i]) {
        if (gap) out.push({ kind: 'gap', count: gap });
        gap = 0;
        out.push({ kind: 'row', row: r });
      } else gap++;
    });
    if (gap) out.push({ kind: 'gap', count: gap });
    return out;
  }, [rows, showAll]);

  const cell = (c: SideCell | null) => (
    <>
      <td className="w-10 select-none border-r px-1.5 text-right align-top text-xs text-slate-400">{c?.no ?? ''}</td>
      <td
        className={cn(
          'whitespace-pre-wrap break-all px-2 align-top',
          c?.type === 'del' && 'bg-red-50 text-red-900',
          c?.type === 'add' && 'bg-emerald-50 text-emerald-900',
          !c && 'bg-slate-100/70',
        )}
      >
        {c ? c.text || ' ' : ''}
      </td>
    </>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{changedCount === 0 ? 'No differences' : `${changedCount} changed line${changedCount === 1 ? '' : 's'}`}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Only changes' : 'Show all lines'}
        </Button>
      </div>
      <div className="overflow-auto rounded-md border bg-card font-mono text-xs leading-5" style={{ maxHeight }}>
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-10" />
            <col />
            <col className="w-10" />
            <col />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-50 text-left font-sans text-sm">
            <tr>
              <th colSpan={2} className="border-b border-r px-2 py-1 font-medium">
                {beforeLabel}
              </th>
              <th colSpan={2} className="border-b px-2 py-1 font-medium">
                {afterLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-3 text-center font-sans text-sm text-muted-foreground">
                  Identical
                </td>
              </tr>
            ) : (
              visible.map((v, i) =>
                v.kind === 'gap' ? (
                  <tr key={`g${i}`}>
                    <td colSpan={4} className="bg-slate-50 px-2 py-0.5 text-center font-sans text-sm text-muted-foreground">
                      … {v.count} unchanged line{v.count === 1 ? '' : 's'} …
                    </td>
                  </tr>
                ) : (
                  <tr key={`r${i}`} className="border-b border-slate-100 last:border-0">
                    {cell(v.row.left)}
                    <Fragment>{cell(v.row.right)}</Fragment>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Field-level diff ────────────────────────────────────────────────────────────────────────────
export interface FieldChange {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before: unknown;
  after: unknown;
}

/** Flatten a JSON value to leaf paths ("a.b.0.c"); empty objects/arrays are leaves. */
export function flattenJson(value: unknown, prefix = '', out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (Array.isArray(value) && value.length > 0) {
    value.forEach((v, i) => flattenJson(v, prefix ? `${prefix}.${i}` : String(i), out));
  } else if (isPlainObject(value) && Object.keys(value).length > 0) {
    for (const [k, v] of Object.entries(value)) flattenJson(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix || '(root)', value);
  }
  return out;
}

/** Leaf-level changes between two JSON values, sorted by path. */
export function fieldDiff(before: unknown, after: unknown): FieldChange[] {
  const a = before === null || before === undefined ? new Map<string, unknown>() : flattenJson(before);
  const b = after === null || after === undefined ? new Map<string, unknown>() : flattenJson(after);
  const out: FieldChange[] = [];
  for (const [path, v] of a) {
    if (!b.has(path)) out.push({ path, kind: 'removed', before: v, after: undefined });
    else if (!jsonEqual(v, b.get(path))) out.push({ path, kind: 'changed', before: v, after: b.get(path) });
  }
  for (const [path, v] of b) if (!a.has(path)) out.push({ path, kind: 'added', before: undefined, after: v });
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

const KIND_TONE = { added: 'success', removed: 'danger', changed: 'warning' } as const;

/** Table of leaf-level changes; `highlight(path)` marks rows (e.g. integrity-relevant keys) with a shield. */
export function FieldDiffTable({
  changes,
  highlight,
  highlightLabel = 'Integrity-relevant',
  emptyText = 'No field changes',
}: {
  changes: FieldChange[];
  highlight?: (path: string) => boolean;
  highlightLabel?: string;
  emptyText?: string;
}) {
  if (changes.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Field</TableHead>
            <TableHead>Change</TableHead>
            <TableHead>Before</TableHead>
            <TableHead>After</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {changes.map((c) => {
            const hl = highlight?.(c.path) ?? false;
            return (
              <TableRow key={c.path} className={cn(hl && 'bg-amber-50/70')}>
                <TableCell className="font-mono text-sm">
                  <span className="inline-flex items-center gap-1">
                    {hl ? <ShieldAlert className="size-4 text-amber-600" aria-label={highlightLabel} /> : null}
                    {c.path}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge tone={KIND_TONE[c.kind]}>{c.kind}</Badge>
                </TableCell>
                <TableCell className="max-w-[16rem] break-all font-mono text-sm text-red-800">
                  {c.kind === 'added' ? '' : compactJson(c.before, 120)}
                </TableCell>
                <TableCell className="max-w-[16rem] break-all font-mono text-sm text-emerald-800">
                  {c.kind === 'removed' ? '' : compactJson(c.after, 120)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
