'use client';

import { AlertTriangle, CheckCircle2, CircleX, FlaskConical, LocateFixed } from 'lucide-react';
import { CopyButton } from '@/components/copy-button';
import { JsonView } from '@/components/json-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { normaliseIssues } from '@/lib/api';
import { shortId } from '@/lib/format';
import { useIsAdvanced } from '@/lib/preferences';
import type { AnalyseResult, ValidationIssue } from '@/lib/types';
import { cn, isPlainObject } from '@/lib/utils';
import { friendlyIssue } from './studio/friendly-issues';

/** Best-effort AnalyseResult from a VALIDATION_FAILED details object (publish 422) or an analyse response. */
export function asAnalyseResult(value: unknown): Partial<AnalyseResult> | null {
  if (!isPlainObject(value)) return null;
  if (!('errors' in value) && !('ok' in value) && !('tests' in value)) return null;
  return value as Partial<AnalyseResult>;
}

interface IssueContext {
  /** The analysed document, to name where each issue is ("Premises › Premises type"). */
  doc?: unknown;
  /** The form a flow uses (names its sections). */
  relatedForm?: unknown;
  /** Jump to the element an issue points at. */
  onLocate?: (target: string) => void;
}

function IssueList({ issues, tone, ctx }: { issues: ValidationIssue[]; tone: 'error' | 'warning'; ctx: IssueContext }) {
  const advanced = useIsAdvanced();
  if (issues.length === 0) return null;
  return (
    <ul
      className={cn(
        'space-y-1.5 rounded-md border px-3 py-2 text-sm',
        tone === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900',
      )}
    >
      {issues.map((i, idx) => {
        const f = friendlyIssue(i, ctx.doc, ctx.relatedForm);
        return (
          <li key={idx} className="flex flex-wrap items-start gap-x-2 gap-y-1">
            <span className="min-w-0 flex-1">
              {f.where ? <span className="font-semibold">{f.where}: </span> : null}
              {f.text}
              {advanced ? (
                <span className="mt-0.5 block text-xs opacity-80">
                  {i.path || i.field ? <code className="mr-1 font-semibold">{i.path ?? i.field}</code> : null}
                  {i.code ? <span className="mr-1">[{i.code}]</span> : null}
                  {i.message}
                </span>
              ) : null}
            </span>
            {f.target && ctx.onLocate ? (
              <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => ctx.onLocate?.(f.target as string)}>
                <LocateFixed /> Show
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Chips({ items, tone }: { items: unknown[]; tone: 'success' | 'danger' | 'warning' }) {
  if (items.length === 0) return <span className="text-sm text-muted-foreground">none</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it, i) => (
        <Badge key={i} tone={tone} className="font-mono">
          {typeof it === 'string' ? it : JSON.stringify(it)}
        </Badge>
      ))}
    </div>
  );
}

/**
 * Renders an analysis (or a publish refusal): verdict, problems in plain language (with code and path in Advanced view),
 * what changed, test cases, and — in Advanced view — the hash and the component requirements.
 */
export function AnalysisResultView({ result, className, doc, relatedForm, onLocate }: { result: Partial<AnalyseResult>; className?: string } & IssueContext) {
  const advanced = useIsAdvanced();
  const errors = normaliseIssues(result.errors ?? []);
  const warnings = normaliseIssues(result.warnings ?? []);
  const changelog = result.changelog ?? { added: [], removed: [], changed: [] };
  const tests = result.tests;
  const failedTests = tests?.results.filter((t) => !t.passed) ?? [];
  const ok = result.ok === true && (tests?.passed ?? true);
  const ctx: IssueContext = { doc, relatedForm, onLocate };
  const counts = { added: changelog.added?.length ?? 0, removed: changelog.removed?.length ?? 0, changed: changelog.changed?.length ?? 0 };

  return (
    <div className={cn('space-y-3 text-sm', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {ok ? (
          <Badge tone="success" className="text-sm">
            <CheckCircle2 /> {advanced ? 'Passes analysis' : 'Ready to publish'}
          </Badge>
        ) : (
          <Badge tone="danger" className="text-sm">
            <CircleX /> {advanced ? 'Publish blocked' : 'Fix these before publishing'}
          </Badge>
        )}
        {result.breaking ? (
          <Badge tone="warning" title="Removes or changes questions in a way older answers or exports may depend on">
            <AlertTriangle /> {advanced ? 'Breaking change' : 'Changes earlier answers'}
          </Badge>
        ) : result.breaking === false && advanced ? (
          <Badge tone="muted">Not breaking</Badge>
        ) : null}
        {result.previous_version ? (
          <span className="text-sm text-muted-foreground">Compared with v{result.previous_version.version}</span>
        ) : result.previous_version === null ? (
          <span className="text-sm text-muted-foreground">First version</span>
        ) : null}
        {advanced && result.definition_hash ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            Hash <code title={result.definition_hash}>{shortId(result.definition_hash, 10, 6)}</code>
            <CopyButton value={result.definition_hash} title="Copy definition hash" />
          </span>
        ) : null}
      </div>
      {!advanced && result.breaking ? (
        <p className="text-sm text-amber-900">
          Some questions were removed or changed in a way that affects answers already collected or exports. Publishing still works; reviewers and exports
          keep the old answers.
        </p>
      ) : null}

      {errors.length > 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium text-red-800">
            {errors.length} problem{errors.length === 1 ? '' : 's'} to fix
          </p>
          <IssueList issues={errors} tone="error" ctx={ctx} />
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium text-amber-800">
            {warnings.length} thing{warnings.length === 1 ? '' : 's'} to check
          </p>
          <IssueList issues={warnings} tone="warning" ctx={ctx} />
        </div>
      ) : null}

      {advanced ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Added</p>
            <Chips items={changelog.added ?? []} tone="success" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Removed</p>
            <Chips items={changelog.removed ?? []} tone="danger" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Changed</p>
            <Chips items={changelog.changed ?? []} tone="warning" />
          </div>
        </div>
      ) : counts.added + counts.removed + counts.changed > 0 ? (
        <p className="text-sm text-muted-foreground">
          Changes: {counts.added} added, {counts.changed} changed, {counts.removed} removed.
        </p>
      ) : result.previous_version ? (
        <p className="text-sm text-muted-foreground">No changes compared with the published version.</p>
      ) : null}

      {tests ? (
        <div className="space-y-1">
          <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
            <FlaskConical className="size-4" /> Test cases:{' '}
            {tests.results.length === 0 ? 'none recorded' : `${tests.results.length - failedTests.length} of ${tests.results.length} passed`}
          </p>
          {failedTests.length > 0 ? (
            <ul className="space-y-1">
              {failedTests.map((t, i) => (
                <li key={i} className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  <span className="font-medium">{t.name}</span>
                  {t.failures.length > 0 ? <JsonView value={t.failures} defaultExpandDepth={1} maxHeight={160} className="mt-1 bg-white" /> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {advanced && result.requires && Object.keys(result.requires).length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Requires (spec, components)</summary>
          <JsonView value={result.requires} defaultExpandDepth={2} maxHeight={200} className="mt-1" />
        </details>
      ) : null}
    </div>
  );
}
