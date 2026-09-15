'use client';

// QA / local helpers. Hidden on production by the nav (components/shell/nav.ts) and refused here as well.
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
import { Details } from '@/components/details';
import { JsonView } from '@/components/json-view';
import { PageHeader } from '@/components/page-header';
import { navItem } from '@/components/shell/nav';
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
      <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs" title="Copy to see the full value">
          {truncateToken(token)}
        </code>
        <CopyButton value={token} title={`Copy the ${label.toLowerCase()}`} />
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
        <PageHeader title="Developer tools" description={null} />
        <ReadOnlyNotice title="Not available on production">Developer tools are only for QA and local testing.</ReadOnlyNotice>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Developer tools"
        description={`Test helpers for ${env.envName}: try an agent sign-in, check the server is answering, and the emergency re-send after a database restore. They never appear on production.`}
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
  const devicesLabel = navItem('/devices')?.label ?? 'Phones and sign-ins';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" /> Try an agent sign-in
        </CardTitle>
        <CardDescription>
          Signs the agent in through the stand-in sign-in source, exactly as the phone app would. This adds a real test phone and sign-in for the agent
          here. Block the phone under {devicesLabel} when you’re done.
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
              <KeyRound /> Step 1: Get a test sign-in
            </Button>
          </div>
        </div>

        {host ? (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Field label="Employee number">
                <span className="font-mono">{host.employee_number}</span>
              </Field>
              <Field label="Made at">
                <DateTime value={typeof host.issued_at === 'number' ? new Date(host.issued_at).toISOString() : host.issued_at} seconds />
              </Field>
            </div>
            <Details summary="Technical details">
              <Field label="Sign-in source">
                <span className="font-mono">{host.issuer}</span>
              </Field>
              <TokenRow label="FESS sign-in token" token={host.token} />
              <Field label="Test phone ID">
                <MonoId value={deviceId} />
              </Field>
            </Details>
            <Button onClick={() => void exchange()} loading={busy === 'exchange'} disabled={session !== null}>
              <ArrowRightLeft /> Step 2: Sign in with it
            </Button>
          </div>
        ) : null}

        <ApiErrorAlert error={error} />

        {session ? (
          <div className="space-y-3 rounded-md border border-emerald-200 p-3">
            <p className="text-sm font-medium text-emerald-800">It worked: the agent is signed in.</p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Field label="Person">
                {sessionUser ? employeeName({ first_name: str(sessionUser.first_name), last_name: str(sessionUser.last_name), employee_number: str(sessionUser.employee_number) }) : agent ? employeeName(agent) : '—'}
              </Field>
              <Field label="Access">
                <SessionScopeBadge scope={session.scope} />
              </Field>
              <Field label="Signed in until">
                <DateTime value={str(session.access_expires_at)} seconds showRelative />
              </Field>
              <Field label="Can renew until">
                <DateTime value={str(session.refresh_expires_at)} showRelative />
              </Field>
            </div>
            <Details summary="Tokens, for testing the API">
              <Field label="Sign-in ID">
                <MonoId value={session.session_id} />
              </Field>
              <TokenRow label="Access token" token={session.access_token} />
              <TokenRow label="Refresh token" token={session.refresh_token} />
            </Details>
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
            <HeartPulse className="size-4" /> Server status
          </CardTitle>
          <CardDescription>Checks that the server is answering.</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => void health.refetch()} loading={health.isFetching}>
          <RotateCw /> Check again
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
              <Badge tone={health.data.ok ? 'success' : 'danger'}>{health.data.ok ? 'Working' : 'Not working'}</Badge>
              {health.data.env ? <span className="text-xs text-muted-foreground">Environment: {health.data.env}</span> : null}
            </div>
            <Details summary="Technical details">
              <p className="break-all text-xs text-muted-foreground">{env.posApiUrl}/v1/health</p>
              <JsonView value={health.data} defaultExpandDepth={1} maxHeight={240} />
            </Details>
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
          <ShieldAlert className="size-4" /> Emergency: ask every phone to re-send
        </CardTitle>
        <CardDescription>
          Only after the database has been restored from a backup. Every phone re-sends everything it still holds, so nothing captured since the backup
          is lost (docs/12 §12).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!staff.isGlobalAdmin ? (
          <ReadOnlyNotice>Only an administrator for all banks can do this.</ReadOnlyNotice>
        ) : (
          <Button variant="destructive" onClick={() => setOpen(true)}>
            <TriangleAlert /> Ask every phone to re-send…
          </Button>
        )}
        {result ? (
          <Alert variant="success">
            <ShieldAlert />
            <AlertTitle>Done</AlertTitle>
            <AlertDescription>
              Phones re-send everything they hold the next time they connect. Asked <DateTime value={result.set_at} seconds />.
              <Details summary="Technical details" className="mt-1">
                <span>
                  New server epoch <MonoId value={result.epoch} />
                </span>
              </Details>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Ask every phone to re-send everything?"
        description="Use this only after a database restore. Every phone sends again everything it still holds."
        destructive
        requireReason
        reasonLabel="Reason"
        reasonPlaceholder="Restored from the 02:00 backup after …"
        confirmLabel="Ask phones to re-send"
        onConfirm={async (reason) => {
          const r = await adminApi.serverEpoch.rotate({ reason });
          setResult(r);
        }}
      >
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Expect a burst of uploads</AlertTitle>
          <AlertDescription>
            Anything that already arrived is recognised and not saved twice, but every phone uploads at once, and an urgent alert is raised.
          </AlertDescription>
        </Alert>
      </ConfirmDialog>
    </Card>
  );
}
