'use client';

// Local / staging helpers. Hidden in production by the nav (components/shell/nav.ts) and refused here as well.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, HeartPulse, KeyRound, RotateCw, ShieldAlert, Smartphone, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { MonoId, ReadOnlyNotice } from '@/components/admin/admin-ui';
import { SessionScopeBadge } from '@/components/admin/devices-sessions';
import { AgentSelect } from '@/components/agent-select';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyButton } from '@/components/copy-button';
import { DateTime } from '@/components/date-time';
import { JsonView } from '@/components/json-view';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi, devApi } from '@/lib/api';
import { env } from '@/lib/env';
import { employeeName } from '@/lib/format';
import { useStaff } from '@/lib/staff';
import type { AuthExchangeResult, HostTokenResult, PosUser, ServerEpochResult } from '@/lib/types';
import { isPlainObject } from '@/lib/utils';

const STAND_IN_ISSUER = 'pos_dev';

function truncateToken(token: string): string {
  return token.length > 28 ? `${token.slice(0, 14)}…${token.slice(-8)}` : token;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

function TokenRow({ label, token }: { label: string; token: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 rounded-md border bg-slate-50 px-2.5 py-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs" title="Copy to see the full value">
          {truncateToken(token)}
        </code>
        <CopyButton value={token} title={`Copy ${label.toLowerCase()}`} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

export default function DevToolsPage() {
  if (env.isProduction) {
    return (
      <>
        <PageHeader title="Dev tools" />
        <ReadOnlyNotice title="Not available in production">Dev tools exist only in local and staging environments.</ReadOnlyNotice>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Dev tools"
        description={`Helpers for ${env.envName} — simulate an agent sign-in through the stand-in issuer, check API health, and the server-epoch break-glass.`}
      />
      <div className="mb-6">
        <Button asChild variant="outline">
          <Link href="/dev-tools/preview-gallery">
            <Smartphone /> Phone preview gallery
          </Link>
        </Button>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <SimulateSignIn />
        <div className="space-y-6">
          <HealthCard />
          <ServerEpochCard />
        </div>
      </div>
    </>
  );
}

function SimulateSignIn() {
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agent, setAgent] = useState<PosUser | null>(null);
  const [host, setHost] = useState<HostTokenResult | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [session, setSession] = useState<AuthExchangeResult | null>(null);
  const [busy, setBusy] = useState<'token' | 'exchange' | null>(null);
  const [error, setError] = useState<unknown>(null);

  function reset() {
    setHost(null);
    setDeviceId(null);
    setSession(null);
    setError(null);
  }

  // Tokens are kept in component state only (not the query cache) and disappear when you leave the page.
  async function getHostToken() {
    if (!agentId) return;
    reset();
    setBusy('token');
    try {
      const result = await devApi.hostToken({ user_id: agentId });
      setHost(result);
      setDeviceId(crypto.randomUUID());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function exchange() {
    if (!host || !deviceId) return;
    setError(null);
    setBusy('exchange');
    try {
      const result = await devApi.exchange({
        issuer: STAND_IN_ISSUER,
        token: host.token,
        issued_at: host.issued_at,
        device: { device_id: deviceId, client_type: 'web', platform: 'admin-devtools' },
      });
      setSession(result);
      await Promise.all(['devices', 'pos_sessions', 'auth_events', 'identity_links'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const sessionUser = session && isPlainObject(session.user) ? session.user : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" /> Simulate an agent sign-in
        </CardTitle>
        <CardDescription>
          Mints a host token from the stand-in issuer <code className="font-mono">{STAND_IN_ISSUER}</code> and exchanges it for a POS
          session, exactly as the module would. It registers a real device (platform admin-devtools) and session for the agent in
          this environment — revoke it under Devices &amp; sessions when you are done.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-1.5">
          <Label>Agent</Label>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-64 flex-1">
              <AgentSelect
                value={agentId}
                onChange={(id, a) => {
                  setAgentId(id);
                  setAgent(a);
                  reset();
                }}
              />
            </div>
            <Button onClick={() => void getHostToken()} disabled={!agentId} loading={busy === 'token'}>
              <KeyRound /> Get host token
            </Button>
          </div>
        </div>

        {host ? (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Field label="Issuer">
                <span className="font-mono">{host.issuer}</span>
              </Field>
              <Field label="Employee number">
                <span className="font-mono">{host.employee_number}</span>
              </Field>
              <Field label="Issued at">
                <DateTime value={typeof host.issued_at === 'number' ? new Date(host.issued_at).toISOString() : host.issued_at} seconds />
              </Field>
            </div>
            <TokenRow label="Host token" token={host.token} />
            <Field label="Simulated device id">
              <MonoId value={deviceId} />
            </Field>
            <Button onClick={() => void exchange()} loading={busy === 'exchange'} disabled={session !== null}>
              <ArrowRightLeft /> Exchange for a POS session
            </Button>
          </div>
        ) : null}

        <ApiErrorAlert error={error} />

        {session ? (
          <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50/40 p-3">
            <p className="text-sm font-medium text-emerald-800">The stand-in issuer works — a POS session was issued.</p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Field label="Session">
                <MonoId value={session.session_id} />
              </Field>
              <Field label="Scope">
                <SessionScopeBadge scope={session.scope} />
              </Field>
              <Field label="User">
                {sessionUser ? employeeName({ first_name: str(sessionUser.first_name), last_name: str(sessionUser.last_name), employee_number: str(sessionUser.employee_number) }) : agent ? employeeName(agent) : '—'}
              </Field>
              <Field label="Access token expires">
                <DateTime value={str(session.access_expires_at)} seconds showRelative />
              </Field>
              <Field label="Refresh token expires">
                <DateTime value={str(session.refresh_expires_at)} showRelative />
              </Field>
            </div>
            <TokenRow label="Access token" token={session.access_token} />
            <TokenRow label="Refresh token" token={session.refresh_token} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function HealthCard() {
  const health = useQuery({ queryKey: ['dev', 'health'], queryFn: () => devApi.health(), retry: false });
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="grid gap-1">
          <CardTitle className="flex items-center gap-2">
            <HeartPulse className="size-4" /> API health
          </CardTitle>
          <CardDescription className="break-all">{env.posApiUrl}/v1/health</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => void health.refetch()} loading={health.isFetching}>
          <RotateCw /> Check
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {health.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : health.error ? (
          <ApiErrorAlert error={health.error} />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge tone={health.data.ok ? 'success' : 'danger'}>{health.data.ok ? 'Healthy' : 'Unhealthy'}</Badge>
              {health.data.env ? <span className="text-xs text-muted-foreground">env: {health.data.env}</span> : null}
            </div>
            <JsonView value={health.data} defaultExpandDepth={1} maxHeight={240} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ServerEpochCard() {
  const staff = useStaff();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ServerEpochResult | null>(null);
  return (
    <Card className="border-red-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-800">
          <ShieldAlert className="size-4" /> Server epoch — break-glass
        </CardTitle>
        <CardDescription>
          After restoring the database from a backup, rotating the epoch makes every device re-send the envelopes it still retains,
          so nothing captured since the restore point is lost (docs/12 §12).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!staff.isGlobalAdmin ? (
          <ReadOnlyNotice>Only an all-bank administrator can rotate the server epoch (D-44).</ReadOnlyNotice>
        ) : (
          <Button variant="destructive" onClick={() => setOpen(true)}>
            <TriangleAlert /> Rotate server epoch…
          </Button>
        )}
        {result ? (
          <Alert variant="success">
            <ShieldAlert />
            <AlertTitle>Epoch rotated</AlertTitle>
            <AlertDescription>
              New epoch <MonoId value={result.epoch} /> set <DateTime value={result.set_at} seconds />.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Rotate the server epoch?"
        destructive
        requireReason
        reasonLabel="Reason (break-glass)"
        reasonPlaceholder="e.g. Restored from the 02:00 backup after incident …"
        confirmLabel="Rotate epoch"
        onConfirm={async (reason) => {
          const r = await adminApi.serverEpoch.rotate({ reason });
          setResult(r);
        }}
      >
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Every device will re-send every envelope it still retains</AlertTitle>
          <AlertDescription>
            Use this only after a database restore. Ingest is idempotent, so re-sent items that already landed are recorded as
            duplicates — but expect a burst of upload traffic from the whole fleet, and a critical alert is raised.
          </AlertDescription>
        </Alert>
      </ConfirmDialog>
    </Card>
  );
}
