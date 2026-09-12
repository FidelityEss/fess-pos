'use client';

// /jobs/import — bank → CSV (parsed in the browser) → column mapping → preview → dry run → create valid rows.
// Rows go to POST /jobs/import in chunks of ≤ 500, sequentially; the server validates every row (docs B1.6).
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, Info, RotateCcw, XCircle } from 'lucide-react';
import Link from 'next/link';
import { type ChangeEvent, useMemo, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { BankSelect } from '@/components/bank-select';
import { FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { adminApi } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { useIsAdvanced } from '@/lib/preferences';
import type { JobImportRowResult, JsonObject, LocationSource } from '@/lib/types';
import { cn } from '@/lib/utils';
import { parseCsv, type ParsedCsv } from './csv';
import { isNumberAttribute, SectionCard } from './job-bits';
import { type AttributeDef, attributeDefs, toNumber, useJobFormContext } from './job-data';

const CHUNK = 500;
const IGNORE = '__ignore__';

interface TargetDef {
  key: string;
  label: string;
  group: string;
  synonyms: string[];
}

const CORE_TARGETS: TargetDef[] = [
  { key: 'merchant_name', label: 'Merchant name', group: 'Job', synonyms: ['merchant', 'merchantname', 'businessname', 'business', 'name', 'legalname', 'registeredname'] },
  { key: 'trading_name', label: 'Trading name', group: 'Job', synonyms: ['tradingname', 'tradingas', 'ta', 'dba'] },
  { key: 'external_ref', label: 'External reference', group: 'Job', synonyms: ['externalref', 'externalreference', 'reference', 'ref', 'bankref', 'bankreference', 'caseref', 'caseid', 'applicationid'] },
  { key: 'mcc_code', label: 'MCC', group: 'Job', synonyms: ['mcc', 'mcccode', 'merchantcategorycode'] },
  { key: 'location_type', label: 'Location type', group: 'Job', synonyms: ['locationtype', 'sitetype', 'premisestype', 'profile'] },
  { key: 'notes', label: 'Notes', group: 'Job', synonyms: ['notes', 'note', 'comments', 'comment', 'instructions'] },
  { key: 'address.line1', label: 'Address line 1', group: 'Address', synonyms: ['address', 'address1', 'addressline1', 'street', 'streetaddress', 'line1'] },
  { key: 'address.line2', label: 'Address line 2', group: 'Address', synonyms: ['address2', 'addressline2', 'line2', 'unit', 'building'] },
  { key: 'address.suburb', label: 'Suburb', group: 'Address', synonyms: ['suburb', 'area'] },
  { key: 'address.city', label: 'City', group: 'Address', synonyms: ['city', 'town'] },
  { key: 'address.province', label: 'Province', group: 'Address', synonyms: ['province', 'state', 'region'] },
  { key: 'address.postal_code', label: 'Postal code', group: 'Address', synonyms: ['postalcode', 'postcode', 'zip', 'zipcode'] },
  { key: 'address.country', label: 'Country', group: 'Address', synonyms: ['country'] },
  { key: 'location.lat', label: 'Latitude (merchant pin)', group: 'Location', synonyms: ['lat', 'latitude', 'gpslat', 'pinlat'] },
  { key: 'location.lng', label: 'Longitude (merchant pin)', group: 'Location', synonyms: ['lng', 'lon', 'long', 'longitude', 'gpslng', 'gpslon', 'pinlng'] },
  { key: 'bank_coordinates.lat', label: 'Bank-supplied latitude', group: 'Location', synonyms: ['banklat', 'banklatitude', 'bankcoordinateslat'] },
  { key: 'bank_coordinates.lng', label: 'Bank-supplied longitude', group: 'Location', synonyms: ['banklng', 'banklon', 'banklongitude', 'bankcoordinateslng'] },
  { key: 'geofence_radius_m', label: 'Fence radius (m)', group: 'Location', synonyms: ['geofenceradius', 'geofenceradiusm', 'radius', 'radiusm'] },
  { key: 'gps_accuracy_max_m', label: 'GPS accuracy (m)', group: 'Location', synonyms: ['gpsaccuracy', 'gpsaccuracymaxm', 'accuracy', 'maxaccuracy'] },
  { key: 'contact.name', label: 'Contact name', group: 'Contact', synonyms: ['contact', 'contactname', 'contactperson'] },
  { key: 'contact.phone', label: 'Contact phone', group: 'Contact', synonyms: ['phone', 'contactphone', 'telephone', 'tel', 'mobile', 'cell', 'contactnumber'] },
  { key: 'contact.email', label: 'Contact email', group: 'Contact', synonyms: ['email', 'contactemail', 'emailaddress'] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function targetsFor(attrs: AttributeDef[]): TargetDef[] {
  return [
    ...CORE_TARGETS,
    ...attrs.map((a) => ({ key: `attributes.${a.key}`, label: a.label, group: 'Bank attributes', synonyms: [norm(a.key), norm(a.label)] })),
  ];
}

/** Map each header to the first unused target whose key, label or synonym matches (attributes first). */
function autoMatch(headers: string[], targets: TargetDef[]): string[] {
  const used = new Set<string>();
  const ordered = [...targets.filter((t) => t.group === 'Bank attributes'), ...targets.filter((t) => t.group !== 'Bank attributes')];
  return headers.map((h) => {
    const n = norm(h);
    const hit = ordered.find((t) => !used.has(t.key) && (norm(t.key) === n || norm(t.label) === n || t.synonyms.includes(n)));
    if (!hit) return IGNORE;
    used.add(hit.key);
    return hit.key;
  });
}

function parseBool(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(s)) return true;
  if (['no', 'n', 'false', '0'].includes(s)) return false;
  return null;
}

/** Build one POST /jobs body (minus bank_id). Unparseable values are sent as-is so the server reports them. */
function buildRow(cells: string[], mapping: string[], attrs: AttributeDef[], coordSource: LocationSource): JsonObject {
  const row: JsonObject = {};
  const address: JsonObject = {};
  const contact: JsonObject = {};
  const loc: Record<string, unknown> = {};
  const bank: Record<string, unknown> = {};
  const attributes: JsonObject = {};
  mapping.forEach((target, i) => {
    if (target === IGNORE) return;
    const raw = (cells[i] ?? '').trim();
    if (!raw) return;
    const [head, sub] = target.split('.', 2) as [string, string | undefined];
    if (head === 'address' && sub) address[sub] = raw;
    else if (head === 'contact' && sub) contact[sub] = raw;
    else if (head === 'location' && sub) loc[sub] = toNumber(raw) ?? raw;
    else if (head === 'bank_coordinates' && sub) bank[sub] = toNumber(raw) ?? raw;
    else if (head === 'attributes' && sub) {
      const def = attrs.find((a) => a.key === sub);
      if (def && isNumberAttribute(def)) attributes[sub] = toNumber(raw) ?? raw;
      else if (def?.type === 'boolean') attributes[sub] = parseBool(raw) ?? raw;
      else if (def?.type === 'multi_select') attributes[sub] = raw.split(/[;|]/).map((x) => x.trim()).filter(Boolean);
      else attributes[sub] = raw;
    } else if (head === 'geofence_radius_m' || head === 'gps_accuracy_max_m') row[head] = toNumber(raw) ?? raw;
    else row[head] = raw;
  });
  if (Object.keys(bank).length) address.bank_coordinates = bank;
  row.address = address;
  if (Object.keys(loc).length) {
    row.location = loc;
    row.location_source = coordSource;
  }
  if (Object.keys(contact).length) row.contact = contact;
  if (Object.keys(attributes).length) row.attributes = attributes;
  return row;
}

interface Report {
  dryRun: boolean;
  /** Per CSV data row (0-based), the server's verdict. */
  rows: Map<number, JobImportRowResult>;
}

async function runChunks(
  bankId: string,
  rows: { csvIndex: number; body: JsonObject }[],
  dryRun: boolean,
  onProgress: (done: number) => void,
): Promise<Map<number, JobImportRowResult>> {
  const out = new Map<number, JobImportRowResult>();
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const res = await adminApi.jobs.import({ bank_id: bankId, rows: chunk.map((r) => r.body), dry_run: dryRun });
    for (const r of res.rows) {
      const src = chunk[r.index];
      if (src) out.set(src.csvIndex, { ...r, index: src.csvIndex });
    }
    onProgress(Math.min(rows.length, start + chunk.length));
  }
  return out;
}

export function JobImport() {
  const queryClient = useQueryClient();
  const advanced = useIsAdvanced();
  const [bankId, setBankId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [coordSource, setCoordSource] = useState<LocationSource>('bank_supplied');
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState<null | { label: string; done: number; total: number }>(null);
  const [error, setError] = useState<unknown>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const ctx = useJobFormContext(bankId);
  const attrs = useMemo(() => attributeDefs(ctx.data?.job_schema?.definition), [ctx.data]);
  const targets = useMemo(() => targetsFor(attrs), [attrs]);
  const groups = useMemo(() => [...new Set(targets.map((t) => t.group))], [targets]);

  const bodies = useMemo(
    () => (csv ? csv.rows.map((cells, csvIndex) => ({ csvIndex, body: buildRow(cells, mapping, attrs, coordSource) })) : []),
    [csv, mapping, attrs, coordSource],
  );
  const mappedTargets = mapping.filter((m) => m !== IGNORE);
  const duplicates = mappedTargets.filter((m, i) => mappedTargets.indexOf(m) !== i);
  const missingRequired = ['merchant_name', 'address.line1', ...attrs.filter((a) => a.required).map((a) => `attributes.${a.key}`)].filter((k) => !mappedTargets.includes(k));
  const locMapped = mappedTargets.includes('location.lat') || mappedTargets.includes('location.lng');

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setReport(null);
    setError(null);
    setParseError(null);
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      setCsv(null);
      setFileName(file.name);
      setParseError('Excel files are not supported here. In Excel choose File › Save As › "CSV UTF-8", then upload the .csv file.');
      return;
    }
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.headers.length === 0) throw new Error('The file is empty.');
      if (parsed.rows.length === 0) throw new Error('The file has a header row but no data rows.');
      setCsv(parsed);
      setFileName(file.name);
      setMapping(autoMatch(parsed.headers, targets));
    } catch (err) {
      setCsv(null);
      setParseError(err instanceof Error ? err.message : 'Could not read the file.');
    }
  }

  async function run(dryRun: boolean) {
    if (!bankId || !csv) return;
    const rows = dryRun ? bodies : bodies.filter((b) => report?.rows.get(b.csvIndex)?.ok);
    if (rows.length === 0) return;
    setError(null);
    setRunning({ label: dryRun ? 'Checking rows' : 'Creating jobs', done: 0, total: rows.length });
    try {
      const results = await runChunks(bankId, rows, dryRun, (done) => setRunning((r) => (r ? { ...r, done } : r)));
      if (dryRun) setReport({ dryRun: true, rows: results });
      else {
        // Keep dry-run verdicts for rows that were not sent (invalid ones).
        const merged = new Map(report?.rows ?? []);
        for (const [k, v] of results) merged.set(k, v);
        setReport({ dryRun: false, rows: merged });
        await Promise.all([queryClient.invalidateQueries({ queryKey: ['jobs'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] })]);
      }
    } catch (err) {
      setError(err);
    } finally {
      setRunning(null);
    }
  }

  const stats = useMemo(() => {
    if (!report) return null;
    let ok = 0;
    let bad = 0;
    let created = 0;
    for (const r of report.rows.values()) {
      if (r.ok) ok++;
      else bad++;
      if (r.job_id) created++;
    }
    return { ok, bad, created };
  }, [report]);

  const reset = () => {
    setCsv(null);
    setFileName(null);
    setMapping([]);
    setReport(null);
    setError(null);
  };

  const previewCols = mapping.map((m, i) => ({ i, m })).filter((x) => x.m !== IGNORE);
  const labelOf = (key: string) => targets.find((t) => t.key === key)?.label ?? key;
  const merchantCol = mapping.indexOf('merchant_name');

  return (
    <>
      <PageHeader
        title="Import jobs"
        description={`Bulk-create jobs from a CSV file. Check the rows with a dry run first; the server validates every row. Up to ${CHUNK} rows are sent per request.`}
        back={{ href: '/jobs', label: 'Jobs' }}
      />

      <div className="space-y-5">
        <SectionCard title="1. Bank and file" description="Rows are validated against this bank's job schema and geofence profiles.">
          <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
            <FormField label="Bank" htmlFor="import-bank" required>
              <BankSelect
                id="import-bank"
                value={bankId}
                onChange={(v) => {
                  setBankId(v);
                  setReport(null);
                }}
                disabled={!!running}
              />
            </FormField>
            <FormField label="CSV file" htmlFor="import-file" hint={fileName && csv ? `${fileName} — ${formatNumber(csv.rows.length)} rows, ${csv.headers.length} columns` : 'Comma, semicolon or tab separated; first row = column headings.'}>
              <Input id="import-file" type="file" accept=".csv,text/csv,.txt" onChange={(e) => void onFile(e)} disabled={!bankId || !!running} />
            </FormField>
          </div>
          <Alert variant="info" className="mt-4">
            <Info />
            <AlertDescription>Excel (.xlsx) isn&apos;t read directly — save the sheet as CSV (File › Save As › CSV UTF-8) and upload that.</AlertDescription>
          </Alert>
          {parseError ? (
            <Alert variant="destructive" className="mt-3">
              <XCircle />
              <AlertTitle>Could not use {fileName ?? 'this file'}</AlertTitle>
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          ) : null}
        </SectionCard>

        {csv && bankId ? (
          <SectionCard
            title="2. Map columns"
            description="Each column goes to a job field or a bank attribute. Matches were guessed from the headings — check them."
            actions={
              <Button type="button" variant="ghost" size="sm" onClick={() => setMapping(autoMatch(csv.headers, targets))} disabled={!!running}>
                <RotateCcw /> Re-match
              </Button>
            }
          >
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {csv.headers.map((h, i) => (
                <div key={`${h}-${i}`} className="grid gap-1">
                  <span className="break-words text-sm font-medium" title={h}>
                    {h} <span className="font-normal text-muted-foreground">· e.g. “{csv.rows[0]?.[i] ?? ''}”</span>
                  </span>
                  <Select
                    value={mapping[i] ?? IGNORE}
                    onValueChange={(v) => {
                      setMapping((m) => m.map((x, j) => (j === i ? v : x)));
                      setReport(null);
                    }}
                    disabled={!!running}
                  >
                    <SelectTrigger className={cn(duplicates.includes(mapping[i] ?? '') && 'border-destructive')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={IGNORE}>
                        <span className="text-muted-foreground">Ignore this column</span>
                      </SelectItem>
                      {groups.map((g) => (
                        <SelectGroup key={g}>
                          <SelectLabel>{g}</SelectLabel>
                          {targets
                            .filter((t) => t.group === g)
                            .map((t) => (
                              <SelectItem key={t.key} value={t.key}>
                                {t.label}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {locMapped ? (
              <div className="mt-4 max-w-sm">
                <FormField label="Where do the latitude / longitude columns come from?" htmlFor="coord-source" hint="Recorded as the job's location source.">
                  <Select value={coordSource} onValueChange={(v) => setCoordSource(v as LocationSource)}>
                    <SelectTrigger id="coord-source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_supplied">Supplied by the bank</SelectItem>
                      <SelectItem value="geocoded">Geocoded from the address</SelectItem>
                      <SelectItem value="pinned">Pinned on a map</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
            ) : null}

            <div className="mt-4 space-y-2">
              {duplicates.length ? (
                <Alert variant="destructive">
                  <XCircle />
                  <AlertDescription>More than one column maps to: {[...new Set(duplicates)].map(labelOf).join(', ')}. Only the last one would be used — fix the mapping.</AlertDescription>
                </Alert>
              ) : null}
              {missingRequired.length ? (
                <Alert variant="warning">
                  <Info />
                  <AlertDescription>Not mapped (required): {missingRequired.map(labelOf).join(', ')}. Rows without these will fail validation.</AlertDescription>
                </Alert>
              ) : null}
            </div>

            <h3 className="mb-2 mt-5 text-sm font-semibold">Preview (first 5 rows as they will be sent)</h3>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    {previewCols.map(({ i, m }) => (
                      <TableHead key={i}>{labelOf(m)}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {csv.rows.slice(0, 5).map((cells, r) => (
                    <TableRow key={r}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{r + 2}</TableCell>
                      {previewCols.map(({ i }) => (
                        <TableCell key={i} className="max-w-48 break-words" title={cells[i]}>
                          {cells[i] || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => void run(true)} loading={running?.label === 'Checking rows'} disabled={!!running || duplicates.length > 0}>
                Dry run ({formatNumber(csv.rows.length)} rows)
              </Button>
              <Button
                type="button"
                variant="default"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => void run(false)}
                disabled={!report?.dryRun || !stats?.ok || !!running}
                loading={running?.label === 'Creating jobs'}
                title={!report?.dryRun ? 'Run a dry run first' : undefined}
              >
                Create {stats?.ok ? formatNumber(stats.ok) : ''} valid jobs
              </Button>
              <Button type="button" variant="ghost" onClick={reset} disabled={!!running}>
                Start over
              </Button>
              {running ? (
                <span className="text-sm text-muted-foreground">
                  {running.label}: {formatNumber(running.done)} of {formatNumber(running.total)}…
                </span>
              ) : null}
            </div>
            <ApiErrorAlert error={error} className="mt-3" />
          </SectionCard>
        ) : null}

        {report && csv && stats ? (
          <Card>
            <CardContent className="space-y-3 pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-base font-semibold">{report.dryRun ? '3. Dry-run report' : '4. Import report'}</h2>
                {report.dryRun ? (
                  <>
                    <Badge tone="success">{formatNumber(stats.ok)} valid</Badge>
                    <Badge tone={stats.bad ? 'danger' : 'neutral'}>{formatNumber(stats.bad)} invalid</Badge>
                    <span className="text-sm text-muted-foreground">Nothing has been created yet. Fix invalid rows in the file and re-upload, or create the valid ones.</span>
                  </>
                ) : (
                  <>
                    <Badge tone="success">{formatNumber(stats.created)} created</Badge>
                    <Badge tone={stats.bad ? 'danger' : 'neutral'}>{formatNumber(stats.bad)} not created</Badge>
                    <Button variant="link" size="sm" asChild>
                      <Link href="/jobs?dash=pending">View pending jobs</Link>
                    </Button>
                  </>
                )}
                <label className="ml-auto flex items-center gap-2 text-sm">
                  <Checkbox checked={onlyProblems} onCheckedChange={(v) => setOnlyProblems(v === true)} /> Only rows with problems
                </label>
              </div>
              <div className="max-h-[32rem] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Line</TableHead>
                      <TableHead>Merchant</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {csv.rows.map((cells, idx) => {
                      const r = report.rows.get(idx);
                      if (onlyProblems && r?.ok) return null;
                      return (
                        <TableRow key={idx}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{idx + 2}</TableCell>
                          <TableCell className="max-w-56 break-words">{merchantCol >= 0 ? cells[merchantCol] : '—'}</TableCell>
                          <TableCell>
                            {!r ? (
                              <Badge tone="neutral">Not checked</Badge>
                            ) : r.job_id ? (
                              <Badge tone="success">
                                <CheckCircle2 /> Created
                              </Badge>
                            ) : r.ok ? (
                              <Badge tone={report.dryRun ? 'success' : 'neutral'}>{report.dryRun ? 'Valid' : 'Valid (not created)'}</Badge>
                            ) : (
                              <Badge tone="danger">
                                <XCircle /> Invalid
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {r?.reference && r.job_id ? (
                              <Link href={`/jobs/${r.job_id}`} className="font-mono text-primary hover:underline">
                                {r.reference}
                              </Link>
                            ) : r?.errors?.length ? (
                              <ul className="list-disc space-y-0.5 pl-4 text-red-700">
                                {r.errors.map((err, i) => (
                                  <li key={i}>
                                    {err.path || err.field ? (
                                      advanced ? (
                                        <code className="mr-1">{err.path ?? err.field}</code>
                                      ) : (
                                        <span className="mr-1 font-medium">{labelOf(err.path ?? err.field ?? '')}:</span>
                                      )
                                    ) : null}
                                    {err.message}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {!bankId ? (
          <Alert>
            <FileUp />
            <AlertDescription>Choose a bank to start.</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </>
  );
}
