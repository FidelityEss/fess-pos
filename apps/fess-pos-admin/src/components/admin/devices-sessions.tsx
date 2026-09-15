'use client';

// Phones (devices) and sign-ins (POS sessions, docs/07 §2): tables with block / unblock / sign-out actions, used by
// /devices and /users/[id]. Tokens and refresh hashes are never selected.
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Ban, History, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable } from '@/components/data-table';
import { DateTime, useNow } from '@/components/date-time';
import { Details } from '@/components/details';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/api';
import { employeeName, formatNumber, formatRelative } from '@/lib/format';
import { useMutationWithToast } from '@/lib/mutations';
import { useIsAdvanced } from '@/lib/preferences';
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
const REASON_PLACEHOLDER = 'Why? This is recorded in the activity history.';

function sessionState(s: SessionRow, now: number): { label: string; tone: StatusTone; live: boolean } {
  if (s.revoked_at) return { label: 'Signed out', tone: 'danger', live: false };
  if (s.rotated_at) return { label: 'Renewed', tone: 'muted', live: false };
  if (Date.parse(s.expires_at) <= now) return { label: 'Expired', tone: 'muted', live: false };
  return { label: 'Signed in', tone: 'success', live: true };
}

export function SessionScopeBadge({ scope }: { scope: SessionRow['scope'] }) {
  return scope === 'full' ? (
    <Badge tone="info">Full access</Badge>
  ) : (
    <Badge tone="warning" title="This sign-in can only send work that was already started on the phone.">
      Can only finish sending
    </Badge>
  );
}

export function DeviceStatusBadge({ device }: { device: Pick<DeviceRow, 'revoked_at' | 'revoke_reason'> }) {
  return device.revoked_at ? (
    <Badge tone="danger" title={device.revoke_reason ?? undefined}>
      Blocked
    </Badge>
  ) : (
    <Badge tone="success">Allowed</Badge>
  );
}

function deviceSummary(d: DeviceRow): string {
  return [d.client_type === 'web' ? 'Browser' : 'App', d.platform, d.model, d.os_version].filter(Boolean).join(' · ');
}

type DeviceAction = { kind: 'revoke' | 'restore'; device: DeviceRow };

/** Phones with Sign-ins / Block / Unblock actions. `canManage` overrides the per-row scope check (user page). */
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
  const advanced = useIsAdvanced();
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
        header: 'Person',
        accessorFn: (d) => (d.user ? `${d.user.employee_number} ${d.user.first_name} ${d.user.last_name}` : d.user_id),
        cell: ({ row }) =>
          row.original.user ? (
            <Link href={`/users/${row.original.user.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">
              {employeeName(row.original.user)}
            </Link>
          ) : advanced ? (
            <MonoId value={row.original.user_id} />
          ) : (
            <span className="text-muted-foreground">Unknown person</span>
          ),
      });
    }
    cols.push(
      {
        accessorKey: 'device_id',
        header: 'Phone',
        cell: ({ row }) => (
          <div className="grid gap-0.5">
            <span className="text-sm">{deviceSummary(row.original) || 'Unknown phone'}</span>
            {advanced ? <MonoId value={row.original.device_id} /> : null}
          </div>
        ),
      },
      {
        accessorKey: 'module_version',
        header: 'App version',
        cell: ({ row }) => <span className="whitespace-nowrap text-sm">{row.original.module_version ?? '—'}</span>,
      },
      {
        accessorKey: 'host_app_version',
        header: 'FESS app version',
        meta: { advanced: true },
        cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm">{row.original.host_app_version ?? '—'}</span>,
      },
      { accessorKey: 'first_seen_at', header: 'First used', cell: ({ row }) => <DateTime value={row.original.first_seen_at} /> },
      { accessorKey: 'last_seen_at', header: 'Last used', cell: ({ row }) => <DateTime value={row.original.last_seen_at} showRelative /> },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (d) => (d.revoked_at ? 'blocked' : 'allowed'),
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
                <History /> Sign-ins
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
                    <RotateCcw /> Unblock
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
                    <Ban /> Block
                  </Button>
                )
              ) : null}
            </div>
          );
        },
      },
    );
    return cols;
  }, [showUser, allowed, advanced]);

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
        searchPlaceholder="Search phones…"
        emptyTitle="No phones yet"
        emptyDescription={emptyDescription ?? 'A phone appears here after an agent signs in on it from the FESS app.'}
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
    successMessage: (_d, v) => (v.kind === 'revoke' ? 'Phone blocked. The agent is signed out on it.' : 'Phone unblocked. The agent can sign in on it again.'),
  });

  return (
    <ConfirmDialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={revoking ? 'Block this phone?' : 'Unblock this phone?'}
      description={
        revoking
          ? 'The agent is signed out on this phone and can’t use it for visits until you unblock it.'
          : 'The agent can sign in on this phone again. Sign-ins that were ended stay ended, so they sign in afresh.'
      }
      destructive={revoking}
      requireReason
      reasonPlaceholder={REASON_PLACEHOLDER}
      confirmLabel={revoking ? 'Block phone' : 'Unblock phone'}
      onConfirm={(reason) => (device && action ? mutation.mutateAsync({ kind: action.kind, id: device.id, reason }) : undefined)}
    >
      {device ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Phone:</span> {deviceSummary(device) || 'Unknown phone'}
          {device.user ? `, used by ${employeeName(device.user)}` : ''}
        </p>
      ) : null}
      {revoking ? (
        <Alert variant="warning">
          <Ban />
          <AlertDescription className="space-y-1.5">
            <p>
              Anything still waiting on the phone can’t be sent until you unblock it and the agent signs in again. Visits that were ready to start on it
              can’t be started from it.
            </p>
            {pending.isPending ? (
              <Skeleton className="h-4 w-56" />
            ) : pending.data ? (
              <p className="font-medium">
                At its last check-in ({formatRelative(pending.data.received_at)}) it still had {formatNumber(pending.data.pending_total)} item
                {pending.data.pending_total === 1 ? '' : 's'} to send.
              </p>
            ) : (
              <p className="font-medium">This phone hasn’t checked in yet, so we don’t know whether it still has anything to send.</p>
            )}
          </AlertDescription>
        </Alert>
      ) : null}
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
  const advanced = useIsAdvanced();
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
          <SheetTitle>Sign-ins on this phone</SheetTitle>
          <SheetDescription>
            {device ? (
              <>
                {device.user ? `${employeeName(device.user)} · ` : ''}
                {deviceSummary(device) || 'Unknown phone'}
                {advanced ? (
                  <>
                    {' '}
                    · <span className="font-mono">{device.device_id}</span>
                  </>
                ) : null}
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

/** Sign-ins (POS sessions) with "Sign out" on the live head of each rotation family. */
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
    successMessage: 'Signed out. The agent must sign in again on this phone.',
  });

  const columns = useMemo<ColumnDef<SessionRow>[]>(() => {
    const cols: ColumnDef<SessionRow>[] = [
      {
        id: 'state',
        header: 'Status',
        accessorFn: (s) => sessionState(s, now).label,
        cell: ({ row }) => {
          const st = sessionState(row.original, now);
          return <Badge tone={st.tone}>{st.label}</Badge>;
        },
      },
      { accessorKey: 'scope', header: 'Access', cell: ({ row }) => <SessionScopeBadge scope={row.original.scope} /> },
    ];
    if (showDevice) {
      cols.push({ accessorKey: 'device_id', header: 'Phone ID', meta: { advanced: true }, cell: ({ row }) => <MonoId value={row.original.device_id} /> });
    }
    cols.push(
      {
        accessorKey: 'issuer_key',
        header: 'Sign-in source',
        meta: { advanced: true },
        cell: ({ row }) => <span className="whitespace-nowrap font-mono text-sm">{row.original.issuer_key}</span>,
      },
      { accessorKey: 'issued_at', header: 'Signed in', cell: ({ row }) => <DateTime value={row.original.issued_at} /> },
      { accessorKey: 'expires_at', header: 'Ends', cell: ({ row }) => <DateTime value={row.original.expires_at} /> },
      { accessorKey: 'rotated_at', header: 'Renewed', meta: { advanced: true }, cell: ({ row }) => <DateTime value={row.original.rotated_at} /> },
      { accessorKey: 'last_used_at', header: 'Last used', cell: ({ row }) => <DateTime value={row.original.last_used_at} mode="relative" /> },
      {
        accessorKey: 'revoked_at',
        header: 'Signed out',
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
      { accessorKey: 'family_id', header: 'Sign-in group', meta: { advanced: true }, cell: ({ row }) => <MonoId value={row.original.family_id} /> },
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
              <Ban /> Sign out
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
        emptyTitle="No sign-ins yet"
        emptyDescription="A sign-in is recorded each time the agent signs in through the FESS app."
      />
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        title="Sign the agent out on this phone?"
        description="They must sign in again on this phone to keep working. Work already on the phone stays there and is sent once they do."
        destructive
        requireReason
        reasonPlaceholder={REASON_PLACEHOLDER}
        confirmLabel="Sign out"
        onConfirm={(reason) => (target ? mutation.mutateAsync({ id: target.id, reason }) : undefined)}
      >
        {target ? (
          <Details summary="Technical details">
            <p className="text-sm text-muted-foreground">
              Every sign-in in group <code className="text-xs">{target.family_id}</code> on phone <code className="text-xs">{target.device_id}</code> ends.
            </p>
          </Details>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

/** Phones and sign-ins for one person (person detail page). */
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
        <SectionHeading title="Phones" description="Phones this person has signed in on. Blocking a phone signs them out on it." />
        <DevicesTable
          data={devices.data}
          isLoading={devices.isPending}
          error={devices.error}
          onRetry={() => void devices.refetch()}
          canManage={canManage}
          emptyDescription="This person hasn’t signed in on a phone yet."
        />
      </section>
      <section>
        <SectionHeading title="Sign-ins" description="Their 200 most recent sign-ins, on any phone." />
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
