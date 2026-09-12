'use client';

import { useQuery } from '@tanstack/react-query';
import { Archive, ChevronDown, ChevronRight, FlaskConical, Pencil, Plus } from 'lucide-react';
import { Fragment, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateTime } from '@/components/date-time';
import { EmptyState } from '@/components/empty-state';
import { FormField } from '@/components/form-field';
import { JsonEditor, parseJsonText, stringifyJson } from '@/components/json-editor';
import { humanLabel, StructuredView } from '@/components/structured-view';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { adminApi } from '@/lib/api';
import { useMutationWithToast } from '@/lib/mutations';
import { useIsAdvanced } from '@/lib/preferences';
import type { DefinitionFamily, DefinitionTestCase, JsonObject } from '@/lib/types';
import { isPlainObject } from '@/lib/utils';
import { defKeys, fetchTestCases } from './definitions-data';

function TestCaseDialog({
  open,
  onOpenChange,
  family,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  family: DefinitionFamily;
  existing: DefinitionTestCase | null;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [context, setContext] = useState(stringifyJson(existing?.context ?? {}));
  const [steps, setSteps] = useState(stringifyJson(existing?.steps ?? []));
  const [expectations, setExpectations] = useState(stringifyJson(existing?.expectations ?? {}));
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutationWithToast({
    mutationFn: (body: { name: string; context: JsonObject; steps: JsonObject[]; expectations: JsonObject }) =>
      existing ? adminApi.definitions.updateTestCase(existing.id, body) : adminApi.definitions.createTestCase(family.id, body),
    successMessage: existing ? 'Test case saved' : 'Test case created',
    toastErrors: false,
    invalidate: [['definitions', 'test_cases', family.id]],
    onSuccess: () => onOpenChange(false),
  });

  function submit() {
    if (!name.trim()) return setFormError('Name is required');
    const c = parseJsonText(context, { requireObject: true });
    const s = parseJsonText(steps);
    const x = parseJsonText(expectations, { requireObject: true });
    if (!c.ok || !x.ok || !s.ok) return setFormError('Fix the JSON errors first');
    if (!Array.isArray(s.value) || !s.value.every(isPlainObject)) return setFormError('Steps must be an array of objects');
    setFormError(null);
    save.mutate({ name: name.trim(), context: c.value as JsonObject, steps: s.value as JsonObject[], expectations: x.value as JsonObject });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (save.isPending ? undefined : onOpenChange(o))}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit test case' : 'New test case'}</DialogTitle>
          <DialogDescription>
            A recorded scenario: context + answer steps → expected visible / required / errors / computed values. Every test case re-runs on each
            publish and a failure blocks it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[62vh] gap-4 overflow-y-auto pr-1">
          <FormField label="Name" htmlFor="tc-name" required>
            <Input id="tc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Refused access hides the premises section" />
          </FormField>
          <div className="grid gap-4 lg:grid-cols-2">
            <JsonEditor label="Context (object)" id="tc-context" value={context} onChange={setContext} requireObject rows={8} />
            <JsonEditor label="Expectations (object)" id="tc-expect" value={expectations} onChange={setExpectations} requireObject rows={8} />
          </div>
          <JsonEditor label="Steps (array of objects)" id="tc-steps" value={steps} onChange={setSteps} rows={8} />
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <ApiErrorAlert error={save.error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} loading={save.isPending}>
            {existing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Test cases for a family: list, create / edit, archive (docs/04 §9). */
export function TestCasesTab({ family, canEdit: canEditScope }: { family: DefinitionFamily; canEdit: boolean }) {
  const advanced = useIsAdvanced();
  // Test cases are written as JSON (answers → expected results), so creating and editing them is an Advanced-view task.
  const canEdit = canEditScope && advanced;
  const [open, setOpen] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<{ key: number; existing: DefinitionTestCase | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<DefinitionTestCase | null>(null);
  const query = useQuery({ queryKey: defKeys.testCases(family.id, archived), queryFn: () => fetchTestCases(family.id, archived) });

  const archive = useMutationWithToast({
    mutationFn: (id: string) => adminApi.definitions.archiveTestCase(id),
    successMessage: 'Test case archived',
    toastErrors: false,
    invalidate: [['definitions', 'test_cases', family.id]],
  });

  return (
    <div className="space-y-4">
      {family.kind !== 'form' ? (
        <Alert variant="info">
          <FlaskConical />
          <AlertDescription>Test cases exercise form definitions. For {family.kind} families they are stored but skipped at publish.</AlertDescription>
        </Alert>
      ) : null}
      {!advanced ? (
        <p className="text-sm text-muted-foreground">
          A test case is a recorded example: given these answers, these questions must show, be required or show an error. Every test case runs again before each
          publish, and a failure stops the publish. Click one to read it. {canEditScope ? 'To add or change test cases, switch to Advanced view.' : ''}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Switch id="tc-archived" checked={archived} onCheckedChange={setArchived} />
          <Label htmlFor="tc-archived">Show archived</Label>
        </div>
        {canEdit && !archived ? (
          <Button type="button" onClick={() => setEditing({ key: Date.now(), existing: null })}>
            <Plus /> New test case
          </Button>
        ) : null}
      </div>
      {query.error ? <ApiErrorAlert error={query.error} onRetry={() => void query.refetch()} /> : null}
      <Card className="overflow-hidden">
        {query.isPending ? (
          <Skeleton className="m-4 h-24" />
        ) : (query.data ?? []).length === 0 ? (
          <EmptyState icon={FlaskConical} title={archived ? 'No archived test cases' : 'No test cases yet'} description="Record scenarios so every publish is checked against them." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Steps</TableHead>
                <TableHead>Expectations</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(query.data ?? []).map((t) => (
                <Fragment key={t.id}>
                <TableRow className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen((o) => (o === t.id ? null : t.id))}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-1">
                      {open === t.id ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                      {t.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{Array.isArray(t.steps) ? t.steps.length : 0}</TableCell>
                  <TableCell className={advanced ? 'font-mono text-xs text-muted-foreground' : 'text-sm text-muted-foreground'}>
                    {Object.keys(t.expectations ?? {})
                      .map((k) => (advanced ? k : humanLabel(k)))
                      .join(', ') || '—'}
                  </TableCell>
                  <TableCell className="text-xs">
                    <DateTime value={t.archived_at ?? t.updated_at} mode="relative" />
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && !t.archived_at ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing({ key: Date.now(), existing: t });
                          }}
                        >
                          <Pencil /> Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setArchiveTarget(t);
                          }}
                        >
                          <Archive /> Archive
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
                {open === t.id ? (
                  <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
                    <TableCell colSpan={5}>
                      <div className="grid gap-4 py-1 lg:grid-cols-3">
                        <div className="grid gap-1">
                          <p className="text-sm font-semibold">Starting situation</p>
                          <StructuredView value={t.context} />
                        </div>
                        <div className="grid gap-1">
                          <p className="text-sm font-semibold">Answers given</p>
                          <StructuredView value={t.steps} />
                        </div>
                        <div className="grid gap-1">
                          <p className="text-sm font-semibold">Expected result</p>
                          <StructuredView value={t.expectations} />
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {editing ? (
        <TestCaseDialog key={editing.key} open onOpenChange={(o) => (!o ? setEditing(null) : undefined)} family={family} existing={editing.existing} />
      ) : null}
      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(o) => (!o ? setArchiveTarget(null) : undefined)}
        title={`Archive "${archiveTarget?.name ?? ''}"?`}
        description="Archived test cases no longer run on publish. They stay on record."
        confirmLabel="Archive"
        destructive
        onConfirm={() => (archiveTarget ? archive.mutateAsync(archiveTarget.id) : undefined)}
      />
    </div>
  );
}
