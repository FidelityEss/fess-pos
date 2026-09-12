'use client';

import { useQuery } from '@tanstack/react-query';
import { UserCheck, UserX } from 'lucide-react';
import { use, useState } from 'react';
import { canManageUser } from '@/components/admin/access';
import { ActiveBadge, BankList, ReadOnlyNotice, RoleBadge } from '@/components/admin/admin-ui';
import { UserDevicesAndSessions } from '@/components/admin/devices-sessions';
import { ErrorState } from '@/components/api-error-alert';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateTime } from '@/components/date-time';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { adminApi } from '@/lib/api';
import { fullName } from '@/lib/format';
import { isUuid } from '@/lib/hooks';
import { useMutationWithToast } from '@/lib/mutations';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';
import { fetchMaybeRow, pos } from '@/lib/supabase';
import type { PosUser } from '@/lib/types';
import { AdminLoginCard } from './_components/admin-login';
import { AuthEventsTable } from './_components/auth-events';
import { DeactivateDialog } from './_components/deactivate-dialog';
import { IdentityLinks } from './_components/identity-links';
import { PhotoCard } from './_components/photo-card';
import { ProfileCard } from './_components/profile-card';

const BACK = { href: '/users', label: 'Users' };

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const valid = isUuid(id);
  const userQ = useQuery({
    queryKey: ['users', 'detail', id],
    queryFn: () => fetchMaybeRow<PosUser>(pos().from('pos_users').select('*').eq('id', id).maybeSingle()),
    enabled: valid,
  });
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const reactivate = useMutationWithToast({
    mutationFn: (reason: string) => adminApi.users.reactivate(id, { reason }),
    invalidate: [['users'], ['agents'], ['auth_events']],
    toastErrors: false,
    successMessage: 'User reactivated',
  });

  if (!valid) {
    return (
      <>
        <PageHeader title="User" back={BACK} />
        <EmptyState title="That isn’t a valid user link" description="Open the user from the Users list." />
      </>
    );
  }
  if (userQ.isPending) {
    return (
      <>
        <PageHeader title={<Skeleton className="h-7 w-56" />} back={BACK} />
        <Skeleton className="h-96 w-full" />
      </>
    );
  }
  if (userQ.error) {
    return (
      <>
        <PageHeader title="User" back={BACK} />
        <ErrorState error={userQ.error} onRetry={() => void userQ.refetch()} />
      </>
    );
  }
  const user = userQ.data;
  if (!user) {
    return (
      <>
        <PageHeader title="User" back={BACK} />
        <EmptyState title="User not found" description="They may not exist, or they may be outside your banks." />
      </>
    );
  }

  const canManage = canManageUser(staff, user.role, user.bank_ids);
  const isSelf = user.id === staff.me.id;

  return (
    <>
      <PageHeader
        back={BACK}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {fullName(user)} <RoleBadge role={user.role} /> <ActiveBadge active={user.active} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              Employee number <span className="font-mono">{user.employee_number}</span>
            </span>
            <span aria-hidden>·</span>
            <BankList bankIds={user.bank_ids} />
          </span>
        }
        actions={
          canManage ? (
            user.active ? (
              <Button variant="outline" className="text-destructive" onClick={() => setDeactivateOpen(true)} disabled={isSelf} title={isSelf ? 'You can’t deactivate yourself' : undefined}>
                <UserX /> Deactivate
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setReactivateOpen(true)}>
                <UserCheck /> Reactivate
              </Button>
            )
          ) : null
        }
      />

      <div className="mb-4 space-y-3">
        {!user.active ? (
          <Alert variant="warning">
            <UserX />
            <AlertDescription>
              Deactivated <DateTime value={user.deactivated_at} />
              {user.deactivated_reason ? ` — ${user.deactivated_reason}` : ''}. Work they already captured can still upload
              unless their access was hard-revoked.
            </AlertDescription>
          </Alert>
        ) : null}
        {!canManage ? (
          <ReadOnlyNotice>
            You can view this user but not change them. Bank-scoped administrators manage only agents and bank readers within
            their own banks (D-44).
          </ReadOnlyNotice>
        ) : null}
      </div>

      {/* Basic view: the profile only. Identity links, devices & sessions and sign-in activity are technical (Advanced). */}
      {!advanced ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <ProfileCard key={user.updated_at} user={user} canManage={canManage} isSelf={isSelf} />
          <div className="space-y-6">
            <PhotoCard user={user} canManage={canManage} />
            <AdminLoginCard user={user} canManage={canManage} />
          </div>
        </div>
      ) : (
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="identity">Identity links</TabsTrigger>
          <TabsTrigger value="devices">Devices &amp; sessions</TabsTrigger>
          <TabsTrigger value="activity">Sign-in activity</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <ProfileCard key={user.updated_at} user={user} canManage={canManage} isSelf={isSelf} />
            <div className="space-y-6">
              <PhotoCard user={user} canManage={canManage} />
              <AdminLoginCard user={user} canManage={canManage} />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="identity">
          <IdentityLinks user={user} />
        </TabsContent>
        <TabsContent value="devices">
          <UserDevicesAndSessions user={user} />
        </TabsContent>
        <TabsContent value="activity">
          <AuthEventsTable userId={user.id} />
        </TabsContent>
      </Tabs>
      )}

      <DeactivateDialog user={user} open={deactivateOpen} onOpenChange={setDeactivateOpen} />
      <ConfirmDialog
        open={reactivateOpen}
        onOpenChange={setReactivateOpen}
        title={`Reactivate ${fullName(user)}?`}
        description="They can sign in and take new work again. Sessions and devices that were revoked stay revoked — they sign in afresh."
        requireReason
        confirmLabel="Reactivate"
        onConfirm={(reason) => reactivate.mutateAsync(reason)}
      />
    </>
  );
}
