'use client';

// banks.billing_settings editor (docs/06 §3, D-43): per reason category, a default and per-code overrides.
// Precedence at billing time: a per-code value, then the category default, then the reason code's own `billable`.
import { Plus, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useAllReasonCodes } from '@/components/admin/queries';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { humanize } from '@/lib/format';
import { useIsAdvanced } from '@/lib/preferences';
import { type BillingSettings, REASON_CATEGORIES, type ReasonCode } from '@/lib/types';

type Entry = { default?: boolean; codes?: Record<string, boolean> };
const INHERIT = '__inherit__';

/** Drop empty categories / override maps before saving. */
export function cleanBillingSettings(value: BillingSettings): BillingSettings {
  const out: BillingSettings = {};
  for (const [category, entry] of Object.entries(value)) {
    const next: Entry = {};
    if (typeof entry.default === 'boolean') next.default = entry.default;
    if (entry.codes && Object.keys(entry.codes).length > 0) next.codes = { ...entry.codes };
    if (next.default !== undefined || next.codes) out[category] = next;
  }
  return out;
}

export function BillingSettingsEditor({
  value,
  onChange,
  bankId,
  disabled = false,
}: {
  value: BillingSettings;
  onChange: (next: BillingSettings) => void;
  /** The bank being edited (its own reason codes are offered alongside global ones); null for a new bank. */
  bankId: string | null;
  disabled?: boolean;
}) {
  const codesQ = useAllReasonCodes();
  const codes = useMemo(() => {
    // A bank's own code overrides a global code with the same `code` in the same category.
    const byKey = new Map<string, ReasonCode>();
    for (const c of codesQ.data ?? []) {
      if (c.bank_id !== null && c.bank_id !== bankId) continue;
      const key = `${c.category}:${c.code}`;
      const existing = byKey.get(key);
      if (!existing || (existing.bank_id === null && c.bank_id !== null)) byKey.set(key, c);
    }
    return [...byKey.values()];
  }, [codesQ.data, bankId]);

  const shown = useMemo(() => {
    const keys = new Set(Object.keys(value));
    for (const c of codes) if (c.billable) keys.add(c.category);
    const known: string[] = REASON_CATEGORIES.filter((c) => keys.has(c));
    const unknown = [...keys].filter((k) => !(REASON_CATEGORIES as readonly string[]).includes(k));
    return [...known, ...unknown];
  }, [value, codes]);
  const addable = REASON_CATEGORIES.filter((c) => !shown.includes(c));

  function setEntry(category: string, entry: Entry | null) {
    const next: BillingSettings = { ...value };
    if (entry === null) delete next[category];
    else next[category] = entry;
    onChange(next);
  }

  if (codesQ.isPending) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="grid gap-3">
      <ApiErrorAlert error={codesQ.error} title="Could not load reason codes" onRetry={() => void codesQ.refetch()} />
      <p className="text-sm text-muted-foreground">
        A setting for one reason wins, then the category’s default, then the reason’s own setting. Categories with billable reasons are
        listed automatically.
      </p>
      {shown.length === 0 ? <p className="text-sm text-muted-foreground">No billing settings for this bank.</p> : null}
      {shown.map((category) => (
        <CategoryBilling
          key={category}
          category={category}
          entry={value[category]}
          codes={codes.filter((c) => c.category === category)}
          onChange={(entry) => setEntry(category, entry)}
          disabled={disabled}
        />
      ))}
      {addable.length > 0 && !disabled ? (
        <div className="flex items-center gap-2">
          <Select value="" onValueChange={(category) => setEntry(category, {})}>
            <SelectTrigger className="w-80" aria-label="Add a reason category">
              <SelectValue placeholder="Add settings for another category…" />
            </SelectTrigger>
            <SelectContent>
              {addable.map((c) => (
                <SelectItem key={c} value={c}>
                  {humanize(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}

function CategoryBilling({
  category,
  entry,
  codes,
  onChange,
  disabled,
}: {
  category: string;
  entry: Entry | undefined;
  codes: ReasonCode[];
  onChange: (entry: Entry | null) => void;
  disabled: boolean;
}) {
  const advanced = useIsAdvanced();
  const overrides = Object.entries(entry?.codes ?? {});
  const byCode = new Map(codes.map((c) => [c.code, c]));
  const available = codes.filter((c) => !(entry?.codes && c.code in entry.codes));
  const defaultValue = entry?.default === undefined ? INHERIT : String(entry.default);

  function setDefault(v: string) {
    const next: Entry = { ...entry };
    if (v === INHERIT) delete next.default;
    else next.default = v === 'true';
    onChange(next);
  }
  function setCode(code: string, billable: boolean | null) {
    const codesMap = { ...(entry?.codes ?? {}) };
    if (billable === null) delete codesMap[code];
    else codesMap[code] = billable;
    onChange({ ...entry, codes: codesMap });
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold">{humanize(category)}</div>
          <div className="text-sm text-muted-foreground">
            {codes.length} reason{codes.length === 1 ? '' : 's'} · {codes.filter((c) => c.billable).length} billable by default
          </div>
        </div>
        {entry && !disabled ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
            Clear settings
          </Button>
        ) : null}
      </div>
      <div className="grid gap-1.5 sm:max-w-sm">
        <Label>Default for this category</Label>
        <Select value={defaultValue} onValueChange={setDefault} disabled={disabled}>
          <SelectTrigger aria-label={`${humanize(category)} default`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT}>Use each reason’s own setting</SelectItem>
            <SelectItem value="true">Billable</SelectItem>
            <SelectItem value="false">Not billable</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {overrides.length > 0 ? (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reason</TableHead>
                <TableHead>Normally</TableHead>
                <TableHead>For this bank</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {overrides.map(([code, billable]) => {
                const rc = byCode.get(code);
                return (
                  <TableRow key={code}>
                    <TableCell className="min-w-48">
                      <div>
                        {rc ? rc.label : 'Unknown reason'}
                        {rc && !rc.active ? <span className="text-muted-foreground"> (inactive)</span> : null}
                      </div>
                      {advanced || !rc ? <div className="font-mono text-xs text-muted-foreground">{code}</div> : null}
                    </TableCell>
                    <TableCell>
                      {rc ? <Badge tone={rc.billable ? 'warning' : 'muted'}>{rc.billable ? 'Billable' : 'Not billable'}</Badge> : '—'}
                    </TableCell>
                    <TableCell>
                      <Select value={String(billable)} onValueChange={(v) => setCode(code, v === 'true')} disabled={disabled}>
                        <SelectTrigger className="w-40" aria-label={`Billing for ${rc?.label ?? code}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">Billable</SelectItem>
                          <SelectItem value="false">Not billable</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {!disabled ? (
                        <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove override for ${code}`} onClick={() => setCode(code, null)}>
                          <Trash2 />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {available.length > 0 && !disabled ? (
        <Select
          value=""
          onValueChange={(code) => {
            const rc = byCode.get(code);
            setCode(code, rc ? !rc.billable : true);
          }}
        >
          <SelectTrigger className="w-80" aria-label={`Add a setting for one reason in ${humanize(category)}`}>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Plus className="size-4" /> Set one reason differently…
            </span>
          </SelectTrigger>
          <SelectContent>
            {available.map((c) => (
              <SelectItem key={c.id} value={c.code}>
                {c.label}
                {advanced ? <span className="font-mono text-xs text-muted-foreground"> ({c.code})</span> : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
