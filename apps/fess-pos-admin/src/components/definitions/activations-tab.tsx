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
import type { StatusTone } from '@/lib/status';
import type { DefinitionActivation } from '@/lib/types';
import type { ActivatePreset } from './activate-dialog';
import { audienceLabel, currentAllActivation, isInEffect, liveActivations, POLICY_LABEL, type VersionLite } from './definitions-data';

type ActivationStatus = { label: string; tone: StatusTone };

/** Activation history, what is in force now, "Activate…" and one-click rollback (activate the previous version for all). */
export function ActivationsTab({
  versions,
  activations,
  onActivate,
  canEdit,
}: {
  versions: VersionLite[];
  activations: DefinitionActivation[];
  onActivate: (preset?: ActivatePreset) => void;
  canEdit: boolean;
}) {
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

  function statusOf(a: DefinitionActivation): ActivationStatus {
    if (Date.parse(a.effective_from) > now) return { label: 'Scheduled', tone: 'accent' };
    if (!isInEffect(a, now)) return { label: 'Ended', tone: 'muted' };
    if (live.some((l) => l.id === a.id)) return a.audience.type === 'all' ? { label: 'In force', tone: 'success' } : { label: 'Live', tone: 'progress' };
    return { label: 'Superseded', tone: 'muted' };
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {current && currentVersion ? (
            <Alert variant="success">
              <Rocket />
              <AlertTitle>
                v{currentVersion.version} is in force for all agents since <DateTime value={current.effective_from} />
              </AlertTitle>
              <AlertDescription>
                {live.length > 1
                  ? `Also live for narrower audiences: ${live
                      .filter((a) => a.id !== current.id)
                      .map((a) => `v${versionById.get(a.version_id)?.version ?? '?'} (${audienceLabel(a.audience)})`)
                      .join(', ')}.`
                  : 'No staged rollouts in effect.'}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="warning">
              <History />
              <AlertTitle>No version is in force for all agents</AlertTitle>
              <AlertDescription>
                {live.length > 0 ? 'Only staged audiences are live; agents outside them fall back to the global family, if any.' : 'Activate a version to make it live.'}
              </AlertDescription>
            </Alert>
          )}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => onActivate()} disabled={versions.length === 0}>
              <Rocket /> Activate a version…
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!previous || !currentVersion}
              title={previous ? undefined : 'Needs an older version than the one in force'}
              onClick={() =>
                previous && currentVersion
                  ? onActivate({ versionId: previous.id, reason: `Rollback from v${currentVersion.version} to v${previous.version}: ` })
                  : undefined
              }
            >
              <Undo2 /> Roll back{previous ? ` to v${previous.version}` : ''}…
            </Button>
          </div>
        ) : null}
      </div>

      <section>
        <SectionTitle>History (newest first)</SectionTitle>
        <Card className="overflow-hidden">
          {sorted.length === 0 ? (
            <EmptyState title="Never activated" description="Published versions do nothing until they are activated for an audience." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Incompatible devices</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Activated / approved</TableHead>
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
                      <TableCell className="font-medium tabular-nums">v{versionById.get(a.version_id)?.version ?? '?'}</TableCell>
                      <TableCell className="text-xs">{audienceLabel(a.audience)}</TableCell>
                      <TableCell className="text-xs">
                        <DateTime value={a.effective_from} />
                        <span className="text-muted-foreground"> → </span>
                        {a.effective_to ? <DateTime value={a.effective_to} /> : <span className="text-muted-foreground">open-ended</span>}
                      </TableCell>
                      <TableCell className="text-xs">{POLICY_LABEL[a.policy.incompatible ?? 'fallback_version'] ?? String(a.policy.incompatible)}</TableCell>
                      <TableCell className="max-w-xs text-xs">{a.reason}</TableCell>
                      <TableCell className="text-xs">
                        <UserName id={a.activated_by} fallback="System" />
                        <div className="text-muted-foreground">
                          <UserName id={a.approved_by} fallback="no four-eyes" />
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
