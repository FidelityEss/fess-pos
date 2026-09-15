'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ActiveBadge, BankList, PERMISSION_LABEL, ROLE_LABEL, RoleBadge } from '@/components/admin/admin-ui';
import { BankSelect } from '@/components/bank-select';
import { DataTable } from '@/components/data-table';
import { DateTime } from '@/components/date-time';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fullName } from '@/lib/format';
import { isUuid } from '@/lib/hooks';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { fetchRows, pos } from '@/lib/supabase';
import { POS_ROLES, type PosRole, type PosUser } from '@/lib/types';
import { CreateUserDialog } from './_components/create-user-dialog';
import { useWaitingInvitations } from './_components/invitations';
import { WaitingList } from './_components/waiting-list';

const LIMIT = 1000;
const COLUMNS = 'id,employee_number,first_name,last_name,email,role,permissions,active,bank_ids,admin_auth_uid,devices(last_seen_at)';

type UserListRow = Pick<
  PosUser,
  'id' | 'employee_number' | 'first_name' | 'last_name' | 'email' | 'role' | 'permissions' | 'active' | 'bank_ids' | 'admin_auth_uid'
> & { devices: { last_seen_at: string }[] | null };

type StatusFilter = 'all' | 'active' | 'inactive';

function lastSeen(u: UserListRow): string | null {
  let max: string | null = null;
  for (const d of u.devices ?? []) if (!max || Date.parse(d.last_seen_at) > Date.parse(max)) max = d.last_seen_at;
  return max;
}

function matches(u: UserListRow, query: string): boolean {
  const s = query.trim().toLowerCase();
  if (!s) return true;
  return [u.employee_number, u.first_name, u.last_name, `${u.first_name} ${u.last_name}`, u.email ?? ''].some((v) => v.toLowerCase().includes(s));
}

export default function UsersPage() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const router = useRouter();
  const [role, setRole] = useState<PosRole | 'all'>('all');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [bankId, setBankId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const waiting = useWaitingInvitations(null, staff.isAdmin);
  const waitingIds = useMemo(() => new Set((waiting.data ?? []).map((w) => w.user_id)), [waiting.data]);

  const users = useQuery({
    queryKey: ['users', 'list', { role, status, bankId }],
    queryFn: () => {
      let q = pos().from('pos_users').select(COLUMNS);
      if (role !== 'all') q = q.eq('role', role);
      if (status !== 'all') q = q.eq('active', status === 'active');
      if (bankId && isUuid(bankId)) q = q.or(`bank_ids.is.null,bank_ids.cs.{${bankId}}`);
      return fetchRows<UserListRow>(q.order('last_name').order('first_name').limit(LIMIT));
    },
  });

  const columns = useMemo<ColumnDef<UserListRow>[]>(
    () => [
      {
        accessorKey: 'employee_number',
        header: 'Employee no.',
        cell: ({ row }) => (
          <Link href={`/users/${row.original.id}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap font-mono text-sm font-medium hover:underline">
            {row.original.employee_number}
          </Link>
        ),
      },
      {
        id: 'name',
        header: 'Name',
        accessorFn: (u) => `${u.last_name} ${u.first_name}`,
        cell: ({ row }) => (
          <div className="grid min-w-44">
            <span className="font-medium">{fullName(row.original)}</span>
            {row.original.email ? <span className="break-all text-sm text-muted-foreground">{row.original.email}</span> : null}
          </div>
        ),
      },
      { accessorKey: 'role', header: 'Role', cell: ({ row }) => <RoleBadge role={row.original.role} /> },
      {
        id: 'permissions',
        header: 'Permissions',
        accessorFn: (u) => u.permissions.join(' '),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.permissions.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : advanced ? (
            <span className="flex flex-wrap gap-1">
              {row.original.permissions.map((p) => (
                <Badge key={p} tone="outline" className="font-normal">
                  {PERMISSION_LABEL[p]}
                </Badge>
              ))}
            </span>
          ) : (
            <span className="block min-w-44 max-w-64 text-sm">{row.original.permissions.map((p) => PERMISSION_LABEL[p]).join(', ')}</span>
          ),
      },
      { id: 'banks', header: 'Banks', enableSorting: false, cell: ({ row }) => <BankList bankIds={row.original.bank_ids} /> },
      { accessorKey: 'active', header: 'Status', cell: ({ row }) => <ActiveBadge active={row.original.active} /> },
      {
        id: 'admin_login',
        header: 'Admin panel',
        accessorFn: (u) => (u.role === 'pos_agent' ? 'phone app' : waitingIds.has(u.id) ? 'link sent' : u.admin_auth_uid ? 'can sign in' : 'no sign-in'),
        cell: ({ row }) =>
          row.original.role === 'pos_agent' ? (
            <span className="text-sm text-muted-foreground">Uses the phone app</span>
          ) : waitingIds.has(row.original.id) ? (
            <Badge tone="warning">Link sent</Badge>
          ) : row.original.admin_auth_uid ? (
            <Badge tone="success">Can sign in</Badge>
          ) : (
            <Badge tone="muted">No sign-in yet</Badge>
          ),
      },
      {
        id: 'last_seen',
        header: 'Last seen on a phone',
        accessorFn: (u) => lastSeen(u) ?? '',
        cell: ({ row }) => <DateTime value={lastSeen(row.original)} mode="relative" />,
      },
    ],
    [advanced, waitingIds],
  );

  return (
    <>
      <PageHeader
        title="People"
        description="Everyone who uses FESS POS: administrators and bank viewers, who sign in to this panel, and agents, who do the visits."
        actions={
          staff.isAdmin ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Add a person
            </Button>
          ) : null
        }
      />
      <WaitingList />
      <DataTable
        columns={columns}
        data={users.data}
        isLoading={users.isPending}
        error={users.error}
        onRetry={() => void users.refetch()}
        getRowId={(u) => u.id}
        onRowClick={(u) => router.push(`/users/${u.id}`)}
        searchFn={matches}
        searchPlaceholder="Employee number, name or email"
        emptyTitle="No one matches these filters"
        rowClassName={(u) => (u.active ? undefined : 'opacity-70')}
        toolbar={
          <>
            <Select value={role} onValueChange={(v) => setRole(v as PosRole | 'all')}>
              <SelectTrigger className="w-44" aria-label="Filter by role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {POS_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="w-36" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="all">Any status</SelectItem>
              </SelectContent>
            </Select>
            <BankSelect value={bankId} onChange={setBankId} allowAll allLabel="Any bank" includeInactive className="w-52" />
            {bankId ? <span className="text-sm text-muted-foreground">Includes people who work for all banks.</span> : null}
            {users.data && users.data.length >= LIMIT ? (
              <span className="text-sm text-amber-700">Showing the first {LIMIT} — narrow the filters.</span>
            ) : null}
          </>
        }
      />
      <CreateUserDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
