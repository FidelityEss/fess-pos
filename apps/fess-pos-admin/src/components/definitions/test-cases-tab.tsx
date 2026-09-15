'use client';

// "Example answers" (internally: definition test cases, docs/04 §9): saved sets of answers with the result they should
// give. Every one is checked again on publish, and a failure stops the publish.
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
import { defKeys, fetchTestCases, KIND_SINGULAR } from './definitions-data';

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
    successMessage: existing ? 'Example saved.' : 'Example added. It’s checked on every publish from now on.',
    toastErrors: false,
    invalidate: [['definitions', 'test_cases', family.id]],
    onSuccess: () => onOpenChange(false),
  });

  function submit() {
    if (!name.trim()) return setFormError('Enter a name.');
    const c = parseJsonText(context, { requireObject: true });
    const s = parseJsonText(steps);
    const x = parseJsonText(expectations, { requireObject: true });
    if (!c.ok || !x.ok || !s.ok) return setFormError('Fix the highlighted JSON first.');
    if (!Array.isArray(s.value) || !s.value.every(isPlainObject)) return setFormError('“Answers given” must be a list of objects.');
    setFormError(null);
    save.mutate({ name: name.trim(), context: c.value as JsonObject, steps: s.value as JsonObject[], expectations: x.value as JsonObject });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (save.isPending ? undefined : onOpenChange(o))}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{existing ? 'Change this example' : 'Add an example'}</DialogTitle>
          <DialogDescription>
            The starting situation, the answers given, and the result you expect. It’s checked again on every publish, and publishing stops if it no longer
            gives that result.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[62vh] gap-4 overflow-y-auto pr-1">
          <FormField label="Name" htmlFor="tc-name" required>
            <Input id="tc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Refused access hides the premises section" />
          </FormField>
          <div className="grid gap-4 lg:grid-cols-2">
            <JsonEditor label="Starting situation (JSON object)" id="tc-context" value={context} onChange={setContext} requireObject rows={8} />
            <JsonEditor label="Expected result (JSON object)" id="tc-expect" value={expectations} onChange={setExpectations} requireObject rows={8} />
          </div>
          <JsonEditor label="Answers given (JSON list of objects)" id="tc-steps" value={steps} onChange={setSteps} rows={8} />
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <ApiErrorAlert error={save.error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} loading={save.isPending}>
            {existing ? 'Save changes' : 'Add example'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Example answers for a piece: list, add / change, archive. */
export function TestCasesTab({ family, canEdit: canEditScope }: { family: DefinitionFamily; canEdit: boolean }) {
  const advanced = useIsAdvanced();
  // Examples are written as JSON (answers and expected results), so adding and changing them is an Advanced-view task.
  const canEdit = canEditScope && advanced;
  const [open, setOpen] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<{ key: number; existing: DefinitionTestCase | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<DefinitionTestCase | null>(null);
  const query = useQuery({ queryKey: defKeys.testCases(family.id, archived), queryFn: () => fetchTestCases(family.id, archived) });

  const archive = useMutationWithToast({
    mutationFn: (id: string) => adminApi.definitions.archiveTestCase(id),
    successMessage: 'Example archived. It isn’t checked on publish any more.',
    toastErrors: false,
    invalidate: [['definitions', 'test_cases', family.id]],
  });

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Example answers are saved sets of answers with the result you expect, such as which questions should show or must be answered. They’re checked
        again every time you publish, and publishing stops if one no longer gives the expected result. Click one to read it.
        {canEditScope && !advanced ? ' To add or change examples, switch to Advanced view.' : ''}
      </p>
      {family.kind !== 'form' ? (
        <Alert variant="info">
          <FlaskConical />
          <AlertDescription>
            Example answers only apply to questions. Here, in {KIND_SINGULAR[family.kind].toLowerCase()}, they’re kept but not checked when you publish.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Switch id="tc-archived" checked={archived} onCheckedChange={setArchived} />
          <Label htmlFor="tc-archived">Show archived</Label>
        </div>
        {canEdit && !archived ? (
          <Button type="button" onClick={() => setEditing({ key: Date.now(), existing: null })}>
            <Plus /> Add an example
          </Button>
        ) : null}
      </div>
      {query.error ? <ApiErrorAlert error={query.error} onRetry={() => void query.refetch()} /> : null}
      <Card className="overflow-hidden">
        {query.isPending ? (
          <Skeleton className="m-4 h-24" />
        ) : (query.data ?? []).length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            title={archived ? 'No archived examples' : 'No example answers yet'}
            description={archived ? undefined : 'Save an example so every publish is checked against it.'}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Answers given</TableHead>
                <TableHead>What it checks</TableHead>
                <TableHead>{archived ? 'Archived' : 'Last changed'}</TableHead>
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
                            <Pencil /> Change
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
                    <TableRow className="hover:bg-transparent">
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
        title={`Archive “${archiveTarget?.name ?? ''}”?`}
        description="It won’t be checked on publish any more. It stays on record, and you can still read it under Show archived."
        confirmLabel="Archive"
        destructive
        onConfirm={() => (archiveTarget ? archive.mutateAsync(archiveTarget.id) : undefined)}
      />
    </div>
  );
}
