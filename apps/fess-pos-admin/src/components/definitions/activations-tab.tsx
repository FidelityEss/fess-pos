'use client';

import { History, Rocket, Undo2 } from 'lucide-react';
import { useMemo } from 'react';
import { DateTime, useNow } from '@/components/date-time';
import { EmptyState } from '@/components/empty-state';
import { SectionTitle, UserName } from '@/components/ops/ops-shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useIsAdvanced } from '@/lib/preferences';
import type { StatusTone } from '@/lib/status';
import type { DefinitionActivation } from '@/lib/types';
import type { ActivatePreset } from './activate-dialog';
import { audienceLabel, currentAllActivation, isInEffect, liveActivations, liveForLabel, POLICY_LABEL, type VersionLite } from './definitions-data';

type ActivationStatus = { label: string; tone: StatusTone };

/** Where a piece is live: what's live now, "Make a version live…", one-click "Go back" and the history. */
export function ActivationsTab({
  versions,
  activations,
  onActivate,
  canEdit,
  bankName = null,
}: {
  versions: VersionLite[];
  activations: DefinitionActivation[];
  onActivate: (preset?: ActivatePreset) => void;
  canEdit: boolean;
  /** Name of the bank this piece belongs to; null when it's shared by all banks. */
  bankName?: string | null;
}) {
  const advanced = useIsAdvanced();
  const now = useNow(60_000);
  const versionById = useMemo(() => new Map(versions.map((v) => [v.id, v])), [versions]);
  const live = useMemo(() => liveActivations(activations, now), [activations, now]);
  const current = useMemo(() => currentAllActivation(activations, now), [activations, now]);
  const currentVersion = current ? versionById.get(current.version_id) : undefined;
  const previous = currentVersion
    ? versions.filter((v) => v.version < currentVersion.version).sort((a, b) => b.version - a.version)[0]
    : undefined;
  const sorted = useMemo(
    () =>
      [...activations].sort(
        (x, y) => Date.parse(y.effective_from) - Date.parse(x.effective_from) || Date.parse(y.created_at) - Date.parse(x.created_at),
      ),
    [activations],
  );
  const versionText = (a: DefinitionActivation) => `version ${versionById.get(a.version_id)?.version ?? '?'}`;

  function statusOf(a: DefinitionActivation): ActivationStatus {
    if (Date.parse(a.effective_from) > now) return { label: 'Starts later', tone: 'accent' };
    if (!isInEffect(a, now)) return { label: 'Ended', tone: 'muted' };
    if (live.some((l) => l.id === a.id)) return a.audience.type === 'all' ? { label: 'Live', tone: 'success' } : { label: 'Live for some agents', tone: 'progress' };
    return { label: 'Replaced', tone: 'muted' };
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {current && currentVersion ? (
            <Alert variant="success">
              <Rocket />
              <AlertTitle>
                Version {currentVersion.version} is {liveForLabel(current.audience, bankName).replace(/^L/, 'l')} since <DateTime value={current.effective_from} />
              </AlertTitle>
              <AlertDescription>
                {live.length > 1
                  ? `Some agents get a different version for now: ${live
                      .filter((a) => a.id !== current.id)
                      .map((a) => `${versionText(a)} (${audienceLabel(a.audience).replace(/^A/, 'a')})`)
                      .join(', ')}.`
                  : 'Every agent gets this version.'}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="warning">
              <History />
              <AlertTitle>{live.length > 0 ? 'Not live for everyone yet' : 'Not live yet'}</AlertTitle>
              <AlertDescription>
                {live.length > 0
                  ? 'Only some agents get a version. Everyone else gets the set-up shared by all banks, if there is one.'
                  : 'Agents don’t see any version until you make one live.'}
              </AlertDescription>
            </Alert>
          )}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => onActivate()} disabled={versions.length === 0} title={versions.length === 0 ? 'Publish a version first.' : undefined}>
              <Rocket /> Make a version live…
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!previous || !currentVersion}
              title={previous ? undefined : 'There’s no older version to go back to.'}
              onClick={() =>
                previous && currentVersion
                  ? onActivate({ versionId: previous.id, reason: `Going back from version ${currentVersion.version} to version ${previous.version}: ` })
                  : undefined
              }
            >
              <Undo2 /> Go back{previous ? ` to version ${previous.version}` : ''}…
            </Button>
          </div>
        ) : null}
      </div>

      <section>
        <SectionTitle>History, newest first</SectionTitle>
        <Card className="overflow-hidden">
          {sorted.length === 0 ? (
            <EmptyState
              title="Never made live"
              description="A published version does nothing until you make it live."
              action={
                canEdit && versions.length > 0 ? (
                  <Button type="button" onClick={() => onActivate()}>
                    <Rocket /> Make a version live…
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Who gets it</TableHead>
                  <TableHead>When</TableHead>
                  {advanced ? <TableHead>If a phone’s app is too old</TableHead> : null}
                  <TableHead>Why</TableHead>
                  <TableHead>Made live by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((a) => {
                  const s = statusOf(a);
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Badge tone={s.tone}>{s.label}</Badge>
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">{versionById.get(a.version_id)?.version ?? '?'}</TableCell>
                      <TableCell className="text-xs">{a.audience.type === 'all' && bankName ? `All agents at ${bankName}` : audienceLabel(a.audience)}</TableCell>
                      <TableCell className="text-xs">
                        From <DateTime value={a.effective_from} />
                        <div className="text-muted-foreground">{a.effective_to ? <>until <DateTime value={a.effective_to} /></> : 'No end date'}</div>
                      </TableCell>
                      {advanced ? (
                        <TableCell className="text-xs">{POLICY_LABEL[a.policy.incompatible ?? 'fallback_version'] ?? String(a.policy.incompatible)}</TableCell>
                      ) : null}
                      <TableCell className="max-w-xs text-xs">{a.reason}</TableCell>
                      <TableCell className="text-xs">
                        <UserName id={a.activated_by} fallback="The system" />
                        <div className="text-muted-foreground">
                          {a.approved_by ? (
                            <>
                              Approved by <UserName id={a.approved_by} />
                            </>
                          ) : (
                            'No second approval'
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>
    </div>
  );
}
