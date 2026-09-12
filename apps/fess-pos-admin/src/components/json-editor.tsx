'use client';

import { AlertCircle, CheckCircle2, Wand2 } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { ValidationIssue } from '@/lib/types';
import { cn, isPlainObject } from '@/lib/utils';

export interface JsonParseProblem {
  message: string;
  line: number | null;
  column: number | null;
}

export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: JsonParseProblem };

function locate(text: string, message: string): { line: number | null; column: number | null } {
  const lc = /line (\d+) column (\d+)/i.exec(message);
  if (lc) return { line: Number(lc[1]), column: Number(lc[2]) };
  const pos = /position (\d+)/i.exec(message);
  if (pos) {
    const before = text.slice(0, Number(pos[1]));
    const lines = before.split('\n');
    return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
  }
  return { line: null, column: null };
}

/** Parse JSON text, returning the value or a message with line/column. */
export function parseJsonText(text: string, options: { requireObject?: boolean } = {}): JsonParseResult {
  if (!text.trim()) return { ok: false, error: { message: 'Enter some JSON', line: null, column: null } };
  try {
    const value: unknown = JSON.parse(text);
    if (options.requireObject && !isPlainObject(value)) {
      return { ok: false, error: { message: 'Must be a JSON object ({ … })', line: 1, column: 1 } };
    }
    return { ok: true, value };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { message, ...locate(text, message) } };
  }
}

/** Pretty-print a value as 2-space JSON. */
export function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? '';
}

export interface JsonEditorProps {
  value: string;
  onChange: (text: string) => void;
  /** Called whenever the parse result changes. */
  onParsed?: (result: JsonParseResult) => void;
  /** Server-side validation errors shown beneath the editor. */
  serverErrors?: ValidationIssue[];
  requireObject?: boolean;
  label?: string;
  id?: string;
  rows?: number;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
}

/** Monospace JSON textarea with live parse validation, error line display, Format button and server errors. */
export function JsonEditor({
  value,
  onChange,
  onParsed,
  serverErrors,
  requireObject = false,
  label,
  id,
  rows = 16,
  readOnly = false,
  placeholder,
  className,
}: JsonEditorProps) {
  const result = useMemo(() => parseJsonText(value, { requireObject }), [value, requireObject]);
  const onParsedRef = useRef(onParsed);
  onParsedRef.current = onParsed;
  useEffect(() => {
    onParsedRef.current?.(result);
  }, [result]);

  const errorLine = !result.ok && result.error.line !== null ? value.split('\n')[result.error.line - 1] : undefined;

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Tab' || readOnly) return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart, selectionEnd } = el;
    const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    onChange(next);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = selectionStart + 2;
    });
  }

  return (
    <div className={cn('grid gap-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        {label ? <Label htmlFor={id}>{label}</Label> : <span />}
        {!readOnly ? (
          <Button type="button" size="sm" variant="ghost" disabled={!result.ok} onClick={() => result.ok && onChange(stringifyJson(result.value))}>
            <Wand2 /> Format
          </Button>
        ) : null}
      </div>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        rows={rows}
        readOnly={readOnly}
        placeholder={placeholder}
        spellCheck={false}
        aria-invalid={!result.ok || (serverErrors?.length ?? 0) > 0}
        className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 font-mono text-xs leading-5 shadow-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive"
      />
      {result.ok ? (
        <p className="flex items-center gap-1 text-xs text-emerald-700">
          <CheckCircle2 className="size-3.5" /> Valid JSON
        </p>
      ) : (
        <div className="text-xs text-destructive">
          <p className="flex items-center gap-1">
            <AlertCircle className="size-3.5" />
            {result.error.line !== null ? `Line ${result.error.line}, column ${result.error.column}: ` : ''}
            {result.error.message}
          </p>
          {errorLine !== undefined ? (
            <pre className="mt-1 overflow-x-auto rounded bg-red-50 px-2 py-1 font-mono text-xs text-red-900">{errorLine || ' '}</pre>
          ) : null}
        </div>
      )}
      {serverErrors && serverErrors.length > 0 ? (
        <ul className="space-y-0.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
          {serverErrors.map((err, i) => (
            <li key={i}>
              {err.path || err.field ? <code className="mr-1 font-semibold">{err.path ?? err.field}</code> : null}
              {err.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
