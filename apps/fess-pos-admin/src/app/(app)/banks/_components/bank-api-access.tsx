'use client';

// "Access for the bank's systems" on the bank's page (T6-06, D-100, B6.9, docs/17 §4.2): the bank's API keys, making one
// (shown once), switching one off, how to connect, and the recent calls. These act at once; they are not part of the
// sheet's Save.
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Plus, Power } from 'lucide-react';
import { type FormEvent, useId, useMemo, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyButton } from '@/components/copy-button';
import { DateTime } from '@/components/date-time';
import { Details } from '@/components/details';
import { FormField, FormSection } from '@/components/form-field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate, formatNumber } from '@/lib/format';
import { useMutationWithToast } from '@/lib/mutations';
import type { Bank } from '@/lib/types';
import { BankApiHowTo } from './bank-api-howto';
import {
  type BankApiKey,
  bankKeyKeys,
  bankKeysApi,
  callName,
  callResult,
  DEFAULT_KEY_MONTHS,
  fetchBankCalls,
  KEY_MONTHS,
  type NewBankApiKey,
} from './bank-keys-data';

const DAY_MS = 86_400_000;

function KeyStatus({ k }: { k: BankApiKey }) {
  if (k.status === 'revoked') return <Badge tone="muted">Switched off</Badge>;
  if (k.status === 'expired') return <Badge tone="warning">Expired</Badge>;
  const left = k.expires_at ? Math.ceil((Date.parse(k.expires_at) - Date.now()) / DAY_MS) : null;
  if (left !== null && left <= 30) return <Badge tone="warning">Working · ends in {left} day{left === 1 ? '' : 's'}</Badge>;
  return <Badge tone="success">Working</Badge>;
}

function KeyRow({ k, canEdit, onSwitchOff }: { k: BankApiKey; canEdit: boolean; onSwitchOff: (k: BankApiKey) => void }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{k.label}</span>
          <KeyStatus k={k} />
        </div>
        <p className="text-sm text-muted-foreground">
          Ends in <span className="font-mono">…{k.last_four ?? '????'}</span> · made by {k.created_by_name || 'an administrator'} on {formatDate(k.created_at)}
          {k.status === 'active' && k.expires_at ? <> · works until {formatDate(k.expires_at)}</> : null}
          {k.status === 'expired' && k.expires_at ? <> · stopped working on {formatDate(k.expires_at)}</> : null}
        </p>
        <p className="text-sm text-muted-foreground">
          {k.last_used_at ? (
            <>
              Last used <DateTime value={k.last_used_at} mode="relative" />
            </>
          ) : (
            'Not used yet'
          )}{' '}
          · {formatNumber(k.calls_last_24h)} call{k.calls_last_24h === 1 ? '' : 's'} in the last 24 hours
          {k.rate_limit_per_minute ? <> · up to {formatNumber(k.rate_limit_per_minute)} a minute</> : null}
        </p>
        {k.status === 'revoked' ? (
          <p className="text-sm text-muted-foreground">
            Switched off <DateTime value={k.revoked_at} mode="date" />
            {k.revoke_reason ? <>: “{k.revoke_reason}”</> : null}
          </p>
        ) : null}
      </div>
      {canEdit && k.status !== 'revoked' ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onSwitchOff(k)}>
          <Power /> Switch off
        </Button>
      ) : null}
    </li>
  );
}

/** Make a key: name and how long it works → the key, shown once with Copy. */
function CreateKeyDialog({ bank, open, onOpenChange }: { bank: Bank; open: boolean; onOpenChange: (open: boolean) => void }) {
  const uid = useId();
  const [name, setName] = useState('');
  const [months, setMonths] = useState<number>(DEFAULT_KEY_MONTHS);
  const [nameError, setNameError] = useState<string | null>(null);
  const [made, setMade] = useState<NewBankApiKey | null>(null);

  const create = useMutationWithToast({
    mutationFn: (body: { name: string; expires_in_months: number }) => bankKeysApi.create(bank.id, body),
    toastErrors: false,
    invalidate: [bankKeyKeys.list(bank.id)],
    onSuccess: (k) => setMade(k),
  });

  function reset() {
    setName('');
    setMonths(DEFAULT_KEY_MONTHS);
    setNameError(null);
    setMade(null);
    create.reset();
  }

  function close(next: boolean) {
    if (next) return;
    onOpenChange(false);
    reset();
  }

  function submit(e: FormEvent) {
    // The dialog renders in a portal but React events still bubble to the bank sheet's form: stop here.
    e.preventDefault();
    e.stopPropagation();
    if (!name.trim()) {
      setNameError('Give the key a name, so you know later which system uses it.');
      return;
    }
    setNameError(null);
    create.mutate({ name: name.trim(), expires_in_months: months });
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        size="md"
        // Once the key is on screen, only "Done" closes the dialog, so it isn't lost by a stray click.
        onInteractOutside={(e) => (made ? e.preventDefault() : undefined)}
        onEscapeKeyDown={(e) => (made ? e.preventDefault() : undefined)}
        hideClose={!!made}
      >
        {made ? (
          <>
            <DialogHeader>
              <DialogTitle>Copy the key now</DialogTitle>
              <DialogDescription>
                “{made.label}” works for {bank.name} until {made.expires_at ? formatDate(made.expires_at) : 'its end date'}.
              </DialogDescription>
            </DialogHeader>
            <Alert variant="warning">
              <KeyRound />
              <AlertTitle>This is the only time the key is shown</AlertTitle>
              <AlertDescription>
                We keep only a fingerprint of it, so nobody can show it again. Copy it and pass it to the bank’s developers in a safe way,
                such as a password manager, not a plain email. If it’s lost, switch it off and make another.
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
              <code className="min-w-0 flex-1 break-all font-mono text-sm" data-testid="new-api-key">
                {made.key}
              </code>
              <CopyButton value={made.key} label="Copy" variant="outline" title="Copy the key" />
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => close(false)}>
                Done, I’ve copied it
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Create an API key</DialogTitle>
              <DialogDescription>
                A key lets {bank.name}’s own systems collect its finished visits automatically. It can only read, and only this bank’s data.
              </DialogDescription>
            </DialogHeader>
            <FormField label="Name" htmlFor={`${uid}-name`} required error={nameError} hint="So you know later which system uses it, such as “ABC nightly import”.">
              <Input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus aria-invalid={!!nameError || undefined} />
            </FormField>
            <FormField label="Works for" htmlFor={`${uid}-months`} hint="After this it stops working and the bank needs a new key.">
              <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
                <SelectTrigger id={`${uid}-months`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KEY_MONTHS.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m === 1 ? '1 month' : `${m} months`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <ApiErrorAlert error={create.error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)} disabled={create.isPending}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending}>
                Create the key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecentCalls({ bankId, keys }: { bankId: string; keys: BankApiKey[] }) {
  const calls = useQuery({ queryKey: bankKeyKeys.calls(bankId), queryFn: () => fetchBankCalls(bankId) });
  const keyName = useMemo(() => new Map(keys.map((k) => [k.id, `${k.label} (…${k.last_four ?? '????'})`])), [keys]);
  if (calls.isPending) return <Spinner label="Loading recent calls…" />;
  if (calls.error) return <ApiErrorAlert error={calls.error} onRetry={() => void calls.refetch()} />;
  if (!calls.data?.length) return <p className="text-sm text-muted-foreground">No calls yet. They appear here as soon as the bank’s system starts using a key.</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>What it did</TableHead>
            <TableHead>Result</TableHead>
            <TableHead className="text-right">Items</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.data.map((c) => {
            const result = callResult(c.status);
            return (
              <TableRow key={c.id}>
                <TableCell>
                  <DateTime value={c.at} seconds />
                </TableCell>
                <TableCell className="text-sm">{keyName.get(c.key_id) ?? 'A key'}</TableCell>
                <TableCell className="text-sm">{callName(c.method, c.route)}</TableCell>
                <TableCell>
                  <Badge tone={result.tone}>{result.label}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.items ?? '—'}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** The bank's API keys and how its systems connect. Shown to admins with the bank in scope. */
export function BankApiAccess({ bank, canEdit }: { bank: Bank; canEdit: boolean }) {
  const keys = useQuery({ queryKey: bankKeyKeys.list(bank.id), queryFn: () => bankKeysApi.list(bank.id) });
  const [creating, setCreating] = useState(false);
  const [switchingOff, setSwitchingOff] = useState<BankApiKey | null>(null);
  const revoke = useMutationWithToast({
    mutationFn: ({ keyId, reason }: { keyId: string; reason: string }) => bankKeysApi.revoke(keyId, reason),
    toastErrors: false,
    invalidate: [bankKeyKeys.list(bank.id)],
    successMessage: (k) => `“${k.label}” is switched off. The bank’s system can no longer use it.`,
  });
  const list = keys.data ?? [];
  const working = list.filter((k) => k.status === 'active').length;

  return (
    <FormSection
      title="Access for the bank’s systems"
      description="An API key is a long password that lets the bank’s own computer systems collect its finished visits automatically: the answers, the chain of custody and the photos. Changes here happen at once; they don’t need Save."
    >
      {!bank.active ? (
        <Alert variant="warning">
          <AlertDescription>This bank is switched off, so none of its keys work until it’s switched on again.</AlertDescription>
        </Alert>
      ) : null}
      {keys.isPending ? (
        <Spinner label="Loading keys…" />
      ) : keys.error ? (
        <ApiErrorAlert error={keys.error} onRetry={() => void keys.refetch()} />
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No keys yet. Create one when the bank is ready to connect its systems.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {working === 0 ? 'No key is working at the moment.' : `${working} key${working === 1 ? '' : 's'} working.`}
          </p>
          <ul className="divide-y divide-divider border-y border-divider">
            {list.map((k) => (
              <KeyRow key={k.id} k={k} canEdit={canEdit} onSwitchOff={setSwitchingOff} />
            ))}
          </ul>
        </>
      )}
      {canEdit ? (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => setCreating(true)} disabled={!bank.active}>
            <Plus /> Create an API key
          </Button>
        </div>
      ) : null}

      <Details summary="How to connect: a guide for the bank’s developers">
        <BankApiHowTo />
      </Details>
      <Details summary="Recent calls from the bank’s systems">
        <RecentCalls bankId={bank.id} keys={list} />
      </Details>

      <CreateKeyDialog bank={bank} open={creating} onOpenChange={setCreating} />
      <ConfirmDialog
        open={switchingOff !== null}
        onOpenChange={(open) => (open ? undefined : setSwitchingOff(null))}
        title={switchingOff ? `Switch off “${switchingOff.label}”?` : 'Switch off this key?'}
        description="The bank’s system stops being able to use this key straight away. It can’t be switched back on; make a new key if the bank still needs access."
        destructive
        confirmLabel="Switch it off"
        requireReason
        reasonPlaceholder="For example: the bank moved to a new key. It’s saved in the activity history."
        onConfirm={(reason) => (switchingOff ? revoke.mutateAsync({ keyId: switchingOff.id, reason }) : undefined)}
      />
    </FormSection>
  );
}
