'use client';

// Devices and POS sessions (docs/07 §2): tables with revoke / restore / revoke-family actions, used by /devices and
// /users/[id]. Tokens and refresh hashes are never selected.
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Ban, History, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable } from '@/components/data-table';
import { DateTime, useNow } from '@/components/date-time';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/api';
import { employeeName, formatNumber, formatRelative } from '@/lib/format';
import { useMutationWithToast } from '@/lib/mutations';
import { useStaff } from '@/lib/staff';
import type { StatusTone } from '@/lib/status';
import { fetchMaybeRow, fetchRows, pos } from '@/lib/supabase';
import type { Device, PosSession, PosUser } from '@/lib/types';
import { canManageUser } from './access';
import { MonoId, SectionHeading } from './admin-ui';

export const DEVICE_COLUMNS =
  'id,user_id,device_id,client_type,platform,model,os_version,host_app_version,module_version,first_seen_at,last_seen_at,revoked_at,revoke_reason';
export const DEVICE_OWNER_EMBED = 'user:pos_users(id,employee_number,first_name,last_name,role,bank_ids)';

export type DeviceOwner = Pick<PosUser, 'id' | 'employee_number' | 'first_name' | 'last_name' | 'role' | 'bank_ids'>;
export type DeviceRow = Pick<
  Device,
  | 'id'
  | 'user_id'
  | 'device_id'
  | 'client_type'
  | 'platform'
  | 'model'
  | 'os_version'
  | 'host_app_version'
  | 'module_version'
  | 'first_seen_at'
  | 'last_seen_at'
  | 'revoked_at'
  | 'revoke_reason'
> & { user?: DeviceOwner | null };

export const SESSION_COLUMNS =
  'id,user_id,device_id,issuer_key,family_id,scope,issued_at,expires_at,rotated_from,rotated_at,last_used_at,revoked_at,revoke_reason';
export type SessionRow = Pick<
  PosSession,
  | 'id'
  | 'user_id'
  | 'device_id'
  | 'issuer_key'
  | 'family_id'
  | 'scope'
  | 'issued_at'
  | 'expires_at'
  | 'rotated_from'
  | 'rotated_at'
  | 'last_used_at'
  | 'revoked_at'
  | 'revoke_reason'
>;

const INVALIDATE = [['devices'], ['pos_sessions'], ['auth_events'], ['alerts'], ['device_sync_status'], ['users']];

function sessionState(s: SessionRow, now: number): { label: string; tone: StatusTone; live: boolean } {
  if (s.revoked_at) return { label: 'Revoked', tone: 'danger', live: false };
  if (s.rotated_at) return { label: 'Rotated', tone: 'muted', live: false };
  if (Date.parse(s.expires_at) <= now) return { label: 'Expired', tone: 'muted', live: false };
  return { label: 'Active', tone: 'success', live: true };
}

export function SessionScopeBadge({ scope }: { scope: SessionRow['scope'] }) {
  return scope === 'full' ? (
    <Badge tone="info">Full</Badge>
  ) : (
    <Badge tone="warning" title="Only uploads of work already started are accepted (D-35)">
      Upload only
    </Badge>
  );
}

export function DeviceStatusBadge({ device }: { device: Pick<DeviceRow, 'revoked_at' | 'revoke_reason'> }) {
  return device.revoked_at ? (
    <Badge tone="danger" title={device.revoke_reason ?? undefined}>
      Revoked
    </Badge>
  ) : (
    <Badge tone="success">Active</Badge>
  );
}

function deviceSummary(d: DeviceRow): string {
  return [d.client_type === 'web' ? 'Web' : 'Native', d.platform, d.model, d.os_version].filter(Boolean).join(' · ');
}

type DeviceAction = { kind: 'revoke' | 'restore'; device: DeviceRow };

/** Devices with Sessions / Revoke / Restore actions. `canManage` overrides the per-row scope check (user page). */
export function DevicesTable({
  data,
  isLoading,
  error,
  onRetry,
  showUser = false,
  canManage,
  toolbar,
  emptyDescription,
}: {
  data: DeviceRow[] | undefined;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  showUser?: boolean;
  canManage?: boolean;
  toolbar?: ReactNode;
  emptyDescription?: ReactNode;
}) {
  const staff = useStaff();
  const [sessionsFor, setSessionsFor] = useState<DeviceRow | null>(null);
  const [action, setAction] = useState<DeviceAction | null>(null);
  const allowed = useCallback(
    (d: DeviceRow) => canManage ?? (d.user ? canManageUser(staff, d.user.role, d.user.bank_ids) : false),
    [canManage, staff],
  );

  const columns = useMemo<ColumnDef<DeviceRow>[]>(() => {
    const cols: ColumnDef<DeviceRow>[] = [];
    if (showUser) {
      cols.push({
        id: 'user',
        header: 'User',
        accessorFn: (d) => (d.user ? `${d.user.employee_number} ${d.user.first_name} ${d.user.last_name}` : d.user_id),
        cell: ({ row }) =>
          row.original.user ? (
            <Link href={`/users/${row.original.user.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">
              {employeeName(row.original.user)}
            </Link>
          ) : (
            <MonoId value={row.original.user_id} />
          ),
      });
    }
    cols.push(
      {
        accessorKey: 'device_id',
        header: 'Device',
        cell: ({ row }) => (
          <div className="grid gap-0.5">
            <MonoId value={row.original.device_id} />
            <span className="text-sm text-muted-foreground">{deviceSummary(row.original)}</span>
          </div>
        ),
      },
      {
        accessorKey: 'module_version',
        header: 'Module',
        cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm">{row.original.module_version ?? '—'}</span>,
      },
      {
        accessorKey: 'host_app_version',
        header: 'Host app',
        cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm">{row.original.host_app_version ?? '—'}</span>,
      },
      { accessorKey: 'first_seen_at', header: 'First seen', cell: ({ row }) => <DateTime value={row.original.first_seen_at} /> },
      { accessorKey: 'last_seen_at', header: 'Last seen', cell: ({ row }) => <DateTime value={row.original.last_seen_at} showRelative /> },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (d) => (d.revoked_at ? 'revoked' : 'active'),
        cell: ({ row }) => (
          <div className="grid gap-0.5">
            <DeviceStatusBadge device={row.original} />
            {row.original.revoked_at && row.original.revoke_reason ? (
              <span className="max-w-48 break-words text-sm text-muted-foreground" title={row.original.revoke_reason}>
                {row.original.revoke_reason}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableGlobalFilter: false,
        meta: { className: 'text-right', headerClassName: 'w-px' },
        cell: ({ row }) => {
          const d = row.original;
          const can = allowed(d);
          return (
            <div className="flex justify-end gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setSessionsFor(d);
                }}
              >
                <History /> Sessions
              </Button>
              {can ? (
                d.revoked_at ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAction({ kind: 'restore', device: d });
                    }}
                  >
                    <RotateCcw /> Restore
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAction({ kind: 'revoke', device: d });
                    }}
                  >
                    <Ban /> Revoke
                  </Button>
                )
              ) : null}
            </div>
          );
        },
      },
    );
    return cols;
  }, [showUser, allowed]);

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        getRowId={(d) => d.id}
        toolbar={toolbar}
        searchPlaceholder="Search devices…"
        emptyTitle="No devices"
        emptyDescription={emptyDescription ?? 'Devices appear after an agent signs in from the FESS app.'}
        initialSorting={[{ id: 'last_seen_at', desc: true }]}
      />
      <DeviceActionDialog action={action} onClose={() => setAction(null)} />
      <DeviceSessionsSheet
        device={sessionsFor}
        onOpenChange={(open) => {
          if (!open) setSessionsFor(null);
        }}
        canManage={sessionsFor ? allowed(sessionsFor) : false}
      />
    </>
  );
}

function DeviceActionDialog({ action, onClose }: { action: DeviceAction | null; onClose: () => void }) {
  const device = action?.device ?? null;
  const revoking = action?.kind === 'revoke';
  const pending = useQuery({
    queryKey: ['device_sync_status', 'device', device?.user_id ?? null, device?.device_id ?? null],
    queryFn: () =>
      device
        ? fetchMaybeRow<{ pending_total: number; oldest_pending_at: string | null; received_at: string }>(
            pos()
              .from('device_sync_status')
              .select('pending_total,oldest_pending_at,received_at')
              .eq('user_id', device.user_id)
              .eq('device_id', device.device_id)
              .maybeSingle(),
          )
        : Promise.resolve(null),
    enabled: revoking && device !== null,
  });
  const mutation = useMutationWithToast({
    mutationFn: (v: { kind: 'revoke' | 'restore'; id: string; reason: string }) =>
      v.kind === 'revoke' ? adminApi.devices.revoke(v.id, { reason: v.reason }) : adminApi.devices.restore(v.id, { reason: v.reason }),
    invalidate: INVALIDATE,
    toastErrors: false,
    successMessage: (_d, v) => (v.kind === 'revoke' ? 'Device revoked' : 'Device restored'),
  });

  return (
    <ConfirmDialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={revoking ? 'Revoke this device?' : 'Restore this device?'}
      description={device ? `Device ${device.device_id}${device.user ? ` · ${employeeName(device.user)}` : ''}` : undefined}
      destructive={revoking}
      requireReason
      confirmLabel={revoking ? 'Revoke device' : 'Restore device'}
      onConfirm={(reason) => (device && action ? mutation.mutateAsync({ kind: action.kind, id: device.id, reason }) : undefined)}
    >
      {revoking ? (
        <Alert variant="warning">
          <Ban />
          <AlertDescription className="space-y-1.5">
            <p>
              Every session on this device is revoked and its unused inspection tokens are cancelled. Anything still waiting
              on the device can’t upload until the device is restored and the agent signs in again.
            </p>
            {pending.isPending ? (
              <Skeleton className="h-4 w-56" />
            ) : pending.data ? (
              <p className="font-medium">
                Pending on this device at its last sync: {formatNumber(pending.data.pending_total)} item
                {pending.data.pending_total === 1 ? '' : 's'} (reported {formatRelative(pending.data.received_at)}).
              </p>
            ) : (
              <p className="font-medium">No sync report from this device yet — the pending count is unknown.</p>
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="info">
          <RotateCcw />
          <AlertDescription>
            The agent can sign in again from this device. Sessions that were revoked stay revoked.
          </AlertDescription>
        </Alert>
      )}
    </ConfirmDialog>
  );
}

function DeviceSessionsSheet({
  device,
  onOpenChange,
  canManage,
}: {
  device: DeviceRow | null;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
}) {
  const sessions = useQuery({
    queryKey: ['pos_sessions', 'device', device?.user_id ?? null, device?.device_id ?? null],
    queryFn: () =>
      device
        ? fetchRows<SessionRow>(
            pos()
              .from('pos_sessions')
              .select(SESSION_COLUMNS)
              .eq('user_id', device.user_id)
              .eq('device_id', device.device_id)
              .order('issued_at', { ascending: false })
              .limit(200),
          )
        : Promise.resolve([]),
    enabled: device !== null,
  });
  return (
    <Sheet open={device !== null} onOpenChange={onOpenChange}>
      <SheetContent size="xl">
        <SheetHeader>
          <SheetTitle>Sessions on this device</SheetTitle>
          <SheetDescription>
            {device ? (
              <>
                {device.user ? `${employeeName(device.user)} · ` : ''}
                <span className="font-mono">{device.device_id}</span> · {deviceSummary(device)}
              </>
            ) : null}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <SessionsTable
            data={sessions.data}
            isLoading={sessions.isPending}
            error={sessions.error}
            onRetry={() => void sessions.refetch()}
            canManage={canManage}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/** POS sessions with "Revoke session family" on the live head of each rotation family. */
export function SessionsTable({
  data,
  isLoading,
  error,
  onRetry,
  canManage,
  showDevice = false,
}: {
  data: SessionRow[] | undefined;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  canManage: boolean;
  showDevice?: boolean;
}) {
  const now = useNow();
  const [target, setTarget] = useState<SessionRow | null>(null);
  const mutation = useMutationWithToast({
    mutationFn: (v: { id: string; reason: string }) => adminApi.sessions.revoke(v.id, { reason: v.reason }),
    invalidate: INVALIDATE,
    toastErrors: false,
    successMessage: (r) => `Revoked ${r.revoked} session${r.revoked === 1 ? '' : 's'} in the family`,
  });

  const columns = useMemo<ColumnDef<SessionRow>[]>(() => {
    const cols: ColumnDef<SessionRow>[] = [
      {
        id: 'state',
        header: 'State',
        accessorFn: (s) => sessionState(s, now).label,
        cell: ({ row }) => {
          const st = sessionState(row.original, now);
          return <Badge tone={st.tone}>{st.label}</Badge>;
        },
      },
      { accessorKey: 'scope', header: 'Scope', cell: ({ row }) => <SessionScopeBadge scope={row.original.scope} /> },
    ];
    if (showDevice) {
      cols.push({ accessorKey: 'device_id', header: 'Device', cell: ({ row }) => <MonoId value={row.original.device_id} /> });
    }
    cols.push(
      { accessorKey: 'issuer_key', header: 'Issuer', cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm">{row.original.issuer_key}</span> },
      { accessorKey: 'issued_at', header: 'Issued', cell: ({ row }) => <DateTime value={row.original.issued_at} /> },
      { accessorKey: 'expires_at', header: 'Expires', cell: ({ row }) => <DateTime value={row.original.expires_at} /> },
      { accessorKey: 'rotated_at', header: 'Rotated', cell: ({ row }) => <DateTime value={row.original.rotated_at} /> },
      { accessorKey: 'last_used_at', header: 'Last used', cell: ({ row }) => <DateTime value={row.original.last_used_at} mode="relative" /> },
      {
        accessorKey: 'revoked_at',
        header: 'Revoked',
        cell: ({ row }) =>
          row.original.revoked_at ? (
            <div className="grid gap-0.5">
              <DateTime value={row.original.revoked_at} />
              {row.original.revoke_reason ? <span className="break-words text-sm text-muted-foreground">{row.original.revoke_reason}</span> : null}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      { accessorKey: 'family_id', header: 'Family', cell: ({ row }) => <MonoId value={row.original.family_id} /> },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableGlobalFilter: false,
        meta: { className: 'text-right', headerClassName: 'w-px' },
        cell: ({ row }) =>
          canManage && sessionState(row.original, now).live ? (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                setTarget(row.original);
              }}
            >
              <Ban /> Revoke family
            </Button>
          ) : null,
      },
    );
    return cols;
  }, [now, showDevice, canManage]);

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        getRowId={(s) => s.id}
        enableSearch={false}
        pageSize={25}
        emptyTitle="No sessions"
        emptyDescription="A session is created each time the agent signs in through the host app."
      />
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title="Revoke this session family?"
        description={target ? `Family ${target.family_id} on device ${target.device_id}` : undefined}
        destructive
        requireReason
        confirmLabel="Revoke session family"
        onConfirm={(reason) => (target ? mutation.mutateAsync({ id: target.id, reason }) : undefined)}
      >
        <Alert variant="warning">
          <Ban />
          <AlertDescription>
            Every session in this rotation family is revoked. The agent must sign in again on this device; work already on
            the device stays there and uploads once they have.
          </AlertDescription>
        </Alert>
      </ConfirmDialog>
    </>
  );
}

/** Devices and sessions for one user (user detail page). */
export function UserDevicesAndSessions({ user }: { user: Pick<PosUser, 'id' | 'role' | 'bank_ids'> }) {
  const staff = useStaff();
  const canManage = canManageUser(staff, user.role, user.bank_ids);
  const devices = useQuery({
    queryKey: ['devices', 'user', user.id],
    queryFn: () =>
      fetchRows<DeviceRow>(pos().from('devices').select(DEVICE_COLUMNS).eq('user_id', user.id).order('last_seen_at', { ascending: false })),
  });
  const sessions = useQuery({
    queryKey: ['pos_sessions', 'user', user.id],
    queryFn: () =>
      fetchRows<SessionRow>(
        pos().from('pos_sessions').select(SESSION_COLUMNS).eq('user_id', user.id).order('issued_at', { ascending: false }).limit(200),
      ),
  });
  return (
    <div className="space-y-6">
      <section>
        <SectionHeading title="Devices" description="Devices this user has signed in from. Revoking a device revokes its sessions." />
        <DevicesTable
          data={devices.data}
          isLoading={devices.isPending}
          error={devices.error}
          onRetry={() => void devices.refetch()}
          canManage={canManage}
          emptyDescription="This user has not signed in from any device yet."
        />
      </section>
      <section>
        <SectionHeading title="Sessions" description="Most recent 200 POS sessions across all devices." />
        <SessionsTable
          data={sessions.data}
          isLoading={sessions.isPending}
          error={sessions.error}
          onRetry={() => void sessions.refetch()}
          canManage={canManage}
          showDevice
        />
      </section>
    </div>
  );
}
