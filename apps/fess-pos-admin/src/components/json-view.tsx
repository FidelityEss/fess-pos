'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { StructuredView } from '@/components/structured-view';
import { useIsAdvanced } from '@/lib/preferences';
import { cn } from '@/lib/utils';

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-slate-400">null</span>;
  if (value === undefined) return <span className="text-slate-400">undefined</span>;
  if (typeof value === 'string') return <span className="break-all text-emerald-700">{JSON.stringify(value)}</span>;
  if (typeof value === 'number') return <span className="text-blue-700">{String(value)}</span>;
  if (typeof value === 'boolean') return <span className="text-violet-700">{String(value)}</span>;
  return <span>{String(value)}</span>;
}

function JsonNode({
  name,
  value,
  depth,
  expandDepth,
  last,
}: {
  name?: string;
  value: unknown;
  depth: number;
  expandDepth: number;
  last: boolean;
}) {
  const [open, setOpen] = useState(depth < expandDepth);
  const keyPart = name !== undefined ? <span className="text-slate-600">{JSON.stringify(name)}: </span> : null;
  const comma = last ? null : <span className="text-slate-400">,</span>;

  if (value === null || typeof value !== 'object') {
    return (
      <div className="pl-4">
        {keyPart}
        <Primitive value={value} />
        {comma}
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray ? value.map((v, i) => [String(i), v]) : Object.entries(value);
  const [openBr, closeBr] = isArray ? ['[', ']'] : ['{', '}'];

  if (entries.length === 0) {
    return (
      <div className="pl-4">
        {keyPart}
        <span className="text-slate-500">
          {openBr}
          {closeBr}
        </span>
        {comma}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center rounded text-left hover:bg-muted"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="size-3.5 shrink-0 text-slate-400" />}
        <span className="pl-0.5">
          {keyPart}
          <span className="text-slate-500">{openBr}</span>
          {!open ? (
            <>
              <span className="px-1 text-slate-400">{isArray ? `${entries.length} items` : `${entries.length} keys`}</span>
              <span className="text-slate-500">{closeBr}</span>
              {comma}
            </>
          ) : null}
        </span>
      </button>
      {open ? (
        <>
          <div className="ml-[7px] border-l border-slate-200 pl-1">
            {entries.map(([k, v], i) => (
              <JsonNode key={k} name={isArray ? undefined : k} value={v} depth={depth + 1} expandDepth={expandDepth} last={i === entries.length - 1} />
            ))}
          </div>
          <div className="pl-4">
            <span className="text-slate-500">{closeBr}</span>
            {comma}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Data viewer. Shows a readable, structured rendering (StructuredView) to everyone; in Advanced view a toggle adds the
 * raw JSON tree and a copy button (T2-25).
 */
export function JsonView({
  value,
  defaultExpandDepth = 2,
  maxHeight = 480,
  copyable = true,
  className,
}: {
  value: unknown;
  defaultExpandDepth?: number;
  maxHeight?: number | string;
  copyable?: boolean;
  className?: string;
}) {
  const advanced = useIsAdvanced();
  const [raw, setRaw] = useState(false);
  const showRaw = advanced && raw;
  const tab = (active: boolean) => cn('rounded px-2 py-0.5', active ? 'bg-card font-medium text-foreground ring-1 ring-border' : 'text-muted-foreground hover:text-foreground');
  return (
    <div className={cn('rounded-md border bg-card', className)}>
      {advanced ? (
        <div className="flex items-center justify-end gap-1 border-b px-2 py-1">
          <div className="inline-flex rounded-md border bg-muted p-0.5 text-xs" role="tablist" aria-label="Data format">
            <button type="button" role="tab" aria-selected={!showRaw} className={tab(!showRaw)} onClick={() => setRaw(false)}>
              Readable
            </button>
            <button type="button" role="tab" aria-selected={showRaw} className={tab(showRaw)} onClick={() => setRaw(true)}>
              Raw JSON
            </button>
          </div>
          {copyable ? <CopyButton value={JSON.stringify(value, null, 2) ?? ''} title="Copy JSON" /> : null}
        </div>
      ) : null}
      <div className={cn('overflow-auto p-3', showRaw && 'bg-muted font-mono text-xs leading-5')} style={{ maxHeight }}>
        {showRaw ? <JsonNode value={value} depth={0} expandDepth={defaultExpandDepth} last /> : <StructuredView value={value} expandDepth={defaultExpandDepth} />}
      </div>
    </div>
  );
}
