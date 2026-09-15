'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { DEVICE_COLUMNS, DEVICE_OWNER_EMBED, type DeviceRow, DevicesTable } from '@/components/admin/devices-sessions';
import { UserPicker } from '@/components/admin/user-picker';
import { PageHeader } from '@/components/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isUuid } from '@/lib/hooks';
import { fetchRows, pos } from '@/lib/supabase';

const LIMIT = 1000;
const ALL = '__all__';
const NONE = '__none__';

type StatusFilter = 'all' | 'active' | 'revoked';

export default function DevicesPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [moduleVersion, setModuleVersion] = useState<string>(ALL);

  const devices = useQuery({
    queryKey: ['devices', 'list', { userId, status }],
    queryFn: () => {
      let q = pos().from('devices').select(`${DEVICE_COLUMNS},${DEVICE_OWNER_EMBED}`);
      if (userId && isUuid(userId)) q = q.eq('user_id', userId);
      if (status === 'active') q = q.is('revoked_at', null);
      if (status === 'revoked') q = q.not('revoked_at', 'is', null);
      return fetchRows<DeviceRow>(q.order('last_seen_at', { ascending: false }).limit(LIMIT));
    },
  });

  const versions = useMemo(
    () => [...new Set((devices.data ?? []).map((d) => d.module_version ?? NONE))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
    [devices.data],
  );
  const rows = useMemo(
    () => (moduleVersion === ALL ? devices.data : devices.data?.filter((d) => (d.module_version ?? NONE) === moduleVersion)),
    [devices.data, moduleVersion],
  );

  return (
    <>
      <PageHeader title="Phones and sign-ins" />
      <DevicesTable
        data={rows}
        isLoading={devices.isPending}
        error={devices.error}
        onRetry={() => void devices.refetch()}
        showUser
        toolbar={
          <>
            <UserPicker value={userId} onChange={(id) => setUserId(id)} placeholder="Anyone" allowClear className="w-64" />
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="w-36" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="active">Allowed</SelectItem>
                <SelectItem value="revoked">Blocked</SelectItem>
              </SelectContent>
            </Select>
            <Select value={moduleVersion} onValueChange={setModuleVersion}>
              <SelectTrigger className="w-48" aria-label="Filter by app version">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any app version</SelectItem>
                {versions.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v === NONE ? 'Version not known' : v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {devices.data && devices.data.length >= LIMIT ? (
              <span className="text-sm text-amber-700">Showing the {LIMIT} most recently used phones. Narrow the filters to see others.</span>
            ) : null}
          </>
        }
      />
    </>
  );
}
