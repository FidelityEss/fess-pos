'use client';

// Create / edit a job (one form). Attributes render generically from the bank's job schema (create) or the job's
// pinned job-schema version (edit). Core fields lock outside pending/scheduled; location type locks at in_progress.
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Lock, MapPin, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ApiErrorAlert, ErrorState } from '@/components/api-error-alert';
import { BankSelect } from '@/components/bank-select';
import { type FieldErrors, FormActions, FormField, FormGrid, FormSection, apiFieldErrors } from '@/components/form-field';
import { MapView, type MapCircle, type MapMarker } from '@/components/map/map-view';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageSpinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { adminApi, api } from '@/lib/api';
import { humanize } from '@/lib/format';
import { formatLatLng, haversineM } from '@/lib/geo';
import { isUuid, useMccCodes } from '@/lib/hooks';
import { useMutationWithToast } from '@/lib/mutations';
import type { JobCreateBody } from '@/lib/schemas';
import { useStaff } from '@/lib/staff';
import { JOB_STATUS_LABEL } from '@/lib/status';
import type { JobAddress, JobContact, JobRecord, JsonObject, LatLng, LocationSource } from '@/lib/types';
import { isPlainObject } from '@/lib/utils';
import { AttributeInput, attributeHint, coerceAttributeValue, MccPicker, RISK_TIER_TONE } from './job-bits';
import {
  attributeDefs,
  bankCoordinates,
  CORE_EDITABLE,
  invalidateJob,
  isConflictError,
  type JobDetailRow,
  jobPoint,
  LOCATION_TYPE_EDITABLE,
  stableJson as stable,
  toNumber,
  useDefinitionVersions,
  useJob,
  useJobFormContext,
} from './job-data';

const ADDRESS_FIELDS = [
  ['line1', 'Address line 1'],
  ['line2', 'Address line 2'],
  ['suburb', 'Suburb'],
  ['city', 'City'],
  ['province', 'Province'],
  ['postal_code', 'Postal code'],
  ['country', 'Country'],
] as const;
type AddressKey = (typeof ADDRESS_FIELDS)[number][0];

/** Distance above which the pin and the bank's coordinates are flagged `location_mismatch` (B1.2). */
const MISMATCH_M = 250;

interface FormState {
  bankId: string | null;
  merchant_name: string;
  trading_name: string;
  external_ref: string;
  address: Record<AddressKey, string>;
  pin: LatLng | null;
  pinTouched: boolean;
  bankLat: string;
  bankLng: string;
  location_type: string;
  mcc_code: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  notes: string;
  radius: string;
  accuracy: string;
  attributes: Record<string, unknown>;
}

type AddressWithCoords = JobAddress & { bank_coordinates?: LatLng };

/** PATCH /jobs/:id body. Nullable so cleared optional fields reach the API as null (lib JobUpdateBody has no null). */
interface JobPatchBody {
  merchant_name?: string;
  trading_name?: string | null;
  external_ref?: string | null;
  address?: AddressWithCoords;
  location?: LatLng | null;
  location_source?: LocationSource;
  location_type?: string;
  mcc_code?: string | null;
  contact?: JobContact | null;
  notes?: string | null;
  attributes?: JsonObject;
  geofence_radius_m?: number | null;
  gps_accuracy_max_m?: number | null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}

function initialState(job: JobDetailRow | null): FormState {
  const addr = isPlainObject(job?.address) ? (job?.address as unknown as Record<string, unknown>) : {};
  const bank = bankCoordinates(job?.address);
  const attributes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(job?.attributes ?? {})) attributes[k] = typeof v === 'number' ? String(v) : v;
  return {
    bankId: job?.bank_id ?? null,
    merchant_name: job?.merchant_name ?? '',
    trading_name: job?.trading_name ?? '',
    external_ref: job?.external_ref ?? '',
    address: {
      line1: str(addr.line1),
      line2: str(addr.line2),
      suburb: str(addr.suburb),
      city: str(addr.city),
      province: str(addr.province),
      postal_code: str(addr.postal_code),
      country: str(addr.country),
    },
    pin: job ? jobPoint(job) : null,
    pinTouched: false,
    bankLat: bank ? String(bank.lat) : '',
    bankLng: bank ? String(bank.lng) : '',
    location_type: job?.location_type ?? '',
    mcc_code: job?.mcc_code ?? '',
    contactName: str(job?.contact?.name),
    contactPhone: str(job?.contact?.phone),
    contactEmail: str(job?.contact?.email),
    notes: job?.notes ?? '',
    radius: job?.geofence_radius_m ? String(job.geofence_radius_m) : '',
    accuracy: job?.gps_accuracy_max_m ? String(job.gps_accuracy_max_m) : '',
    attributes,
  };
}

const opt = (v: string): string | undefined => (v.trim() ? v.trim() : undefined);

function parseCoords(latS: string, lngS: string): { value: LatLng | null; error: string | null } {
  if (!latS.trim() && !lngS.trim()) return { value: null, error: null };
  const lat = toNumber(latS);
  const lng = toNumber(lngS);
  if (lat === null || lng === null) return { value: null, error: 'Enter both latitude and longitude as numbers' };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { value: null, error: 'Latitude must be −90…90 and longitude −180…180' };
  return { value: { lat, lng }, error: null };
}

function parseIntRange(s: string, min: number, max: number, label: string): { value: number | null; error: string | null } {
  if (!s.trim()) return { value: null, error: null };
  const n = toNumber(s);
  if (n === null || !Number.isInteger(n) || n < min || n > max) return { value: null, error: `${label} must be a whole number from ${min} to ${max}` };
  return { value: n, error: null };
}

export type JobFormProps = { mode: 'create' } | { mode: 'edit'; job: JobDetailRow };

export function JobForm(props: JobFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const staff = useStaff();
  const job = props.mode === 'edit' ? props.job : null;
  const [s, setS] = useState<FormState>(() => initialState(job));
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const setAddress = (k: AddressKey, v: string) => setS((prev) => ({ ...prev, address: { ...prev.address, [k]: v } }));

  const ctx = useJobFormContext(s.bankId);
  const pinned = useDefinitionVersions(job ? [job.job_schema_version_id] : []);
  const schemaDefinition = job ? pinned.data?.[0]?.definition : ctx.data?.job_schema?.definition;
  const attrs = useMemo(() => attributeDefs(schemaDefinition), [schemaDefinition]);
  const { data: mccCodes } = useMccCodes();

  const coreEditable = !job || CORE_EDITABLE.includes(job.status);
  const locationTypeEditable = !job || LOCATION_TYPE_EDITABLE.includes(job.status);
  const nothingEditable = !coreEditable && !locationTypeEditable;

  const locationTypes = useMemo(() => {
    const list = [...(ctx.data?.location_types ?? [])];
    if (job && !list.includes(job.location_type)) list.push(job.location_type);
    return list;
  }, [ctx.data, job]);
  const locationType = s.location_type || ctx.data?.default_location_type || '';
  const profile = ctx.data?.profiles?.[locationType];
  const profileRadius = toNumber(profile?.radius_m);
  const profileAccuracy = toNumber(profile?.max_accuracy_m);
  const radiusOverride = toNumber(s.radius);
  const fenceRadius = radiusOverride ?? profileRadius;

  const bankCoords = parseCoords(s.bankLat, s.bankLng);
  const mismatchM = s.pin && bankCoords.value ? haversineM(s.pin, bankCoords.value) : null;
  const selectedMcc = mccCodes?.find((m) => m.code === s.mcc_code);

  const markers: MapMarker[] = [];
  if (s.pin) markers.push({ id: 'pin', lat: s.pin.lat, lng: s.pin.lng, color: '#006b55', label: `Merchant pin (${formatLatLng(s.pin)})` });
  if (bankCoords.value) markers.push({ id: 'bank', lat: bankCoords.value.lat, lng: bankCoords.value.lng, color: '#d97706', label: `Bank-supplied coordinates (${formatLatLng(bankCoords.value)})` });
  const circles: MapCircle[] = s.pin && fenceRadius ? [{ id: 'fence', lat: s.pin.lat, lng: s.pin.lng, radiusM: fenceRadius, color: '#006b55' }] : [];

  function buildAddress(): AddressWithCoords {
    // Keep keys this form doesn't edit (the API passes unknown address keys through).
    const base: Record<string, unknown> = isPlainObject(job?.address) ? { ...(job?.address as unknown as Record<string, unknown>) } : {};
    for (const [k] of ADDRESS_FIELDS) {
      const v = opt(s.address[k]);
      if (v === undefined) delete base[k];
      else base[k] = v;
    }
    delete base.bank_coordinates;
    if (bankCoords.value) base.bank_coordinates = bankCoords.value;
    return base as unknown as AddressWithCoords;
  }

  function buildContact(): JobContact | null {
    const c: JobContact = {};
    if (opt(s.contactName)) c.name = opt(s.contactName);
    if (opt(s.contactPhone)) c.phone = opt(s.contactPhone);
    if (opt(s.contactEmail)) c.email = opt(s.contactEmail);
    return Object.keys(c).length ? c : null;
  }

  /** Validate locally; returns field errors and the attribute object. */
  function validate(): { errs: FieldErrors; attributes: JsonObject; radius: number | null; accuracy: number | null } {
    const errs: FieldErrors = {};
    if (!job && !s.bankId) errs.bank_id = 'Choose a bank';
    if (coreEditable) {
      if (!s.merchant_name.trim()) errs.merchant_name = 'Merchant name is required';
      if (!s.address.line1.trim()) errs['address.line1'] = 'Address line 1 is required';
      if (s.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.contactEmail.trim())) errs['contact.email'] = 'Must be a valid email address';
      if (bankCoords.error) errs['address.bank_coordinates'] = bankCoords.error;
    }
    const radius = parseIntRange(s.radius, 25, 500, 'Fence radius');
    const accuracy = parseIntRange(s.accuracy, 5, 200, 'GPS accuracy');
    if (coreEditable && radius.error) errs.geofence_radius_m = radius.error;
    if (coreEditable && accuracy.error) errs.gps_accuracy_max_m = accuracy.error;
    if (locationTypeEditable && !locationType) errs.location_type = 'Choose a location type';

    // Keep attribute keys the schema doesn't list (never drop captured data); schema keys are coerced and checked.
    const attributes: JsonObject = {};
    for (const [k, v] of Object.entries(s.attributes)) if (!attrs.some((a) => a.key === k) && v !== undefined) attributes[k] = v;
    for (const def of attrs) {
      const r = coerceAttributeValue(def, s.attributes[def.key]);
      if (r.error && coreEditable) errs[`attributes.${def.key}`] = r.error;
      if (!r.empty) attributes[def.key] = r.value;
    }
    return { errs, attributes, radius: radius.value, accuracy: accuracy.value };
  }

  type Vars = { kind: 'create'; body: JobCreateBody } | { kind: 'edit'; body: JobPatchBody };
  const mutation = useMutationWithToast<JobRecord, Vars>({
    mutationFn: (v) =>
      v.kind === 'create'
        ? adminApi.jobs.create(v.body)
        : // PATCH via the generic client: JobPatchBody allows null to clear optional fields.
          api<JobRecord>('PATCH', `/v1/admin/jobs/${encodeURIComponent(job?.id ?? '')}`, v.body),
    toastErrors: false,
    successMessage: (r, v) => (v.kind === 'create' ? `Job ${r.reference} created` : `Job ${r.reference} updated`),
    onSuccess: async (r) => {
      await invalidateJob(queryClient, r.id);
      router.push(`/jobs/${r.id}`);
    },
    onError: (e) => {
      setErrors(apiFieldErrors(e));
      if (job && isConflictError(e)) void invalidateJob(queryClient, job.id);
    },
  });

  function submit() {
    const { errs, attributes, radius, accuracy } = validate();
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    const address = buildAddress();
    const contact = buildContact();
    if (!job) {
      const body: JobCreateBody = {
        bank_id: s.bankId ?? '',
        merchant_name: s.merchant_name.trim(),
        trading_name: opt(s.trading_name),
        external_ref: opt(s.external_ref),
        address,
        location: s.pin ?? undefined,
        location_source: s.pin ? 'pinned' : undefined,
        location_type: locationType || undefined,
        mcc_code: s.mcc_code || undefined,
        contact: contact ?? undefined,
        notes: opt(s.notes),
        attributes,
        geofence_radius_m: radius ?? undefined,
        gps_accuracy_max_m: accuracy ?? undefined,
      };
      mutation.mutate({ kind: 'create', body });
      return;
    }
    const patch: JobPatchBody = {};
    if (coreEditable) {
      if (s.merchant_name.trim() !== job.merchant_name) patch.merchant_name = s.merchant_name.trim();
      if ((opt(s.trading_name) ?? null) !== (job.trading_name ?? null)) patch.trading_name = opt(s.trading_name) ?? null;
      if ((opt(s.external_ref) ?? null) !== (job.external_ref ?? null)) patch.external_ref = opt(s.external_ref) ?? null;
      if ((opt(s.notes) ?? null) !== (job.notes ?? null)) patch.notes = opt(s.notes) ?? null;
      if ((s.mcc_code || null) !== (job.mcc_code ?? null)) patch.mcc_code = s.mcc_code || null;
      if (stable(address) !== stable(job.address)) patch.address = address;
      if (stable(contact) !== stable(job.contact && Object.keys(job.contact).length ? job.contact : null)) patch.contact = contact;
      if (radius !== (job.geofence_radius_m ?? null)) patch.geofence_radius_m = radius;
      if (accuracy !== (job.gps_accuracy_max_m ?? null)) patch.gps_accuracy_max_m = accuracy;
      if (stable(attributes) !== stable(job.attributes ?? {})) patch.attributes = attributes;
      if (s.pinTouched) {
        patch.location = s.pin;
        if (s.pin) patch.location_source = 'pinned';
      }
    }
    if (locationTypeEditable && locationType && locationType !== job.location_type) patch.location_type = locationType;
    if (Object.keys(patch).length === 0) {
      toast.info('Nothing has changed');
      return;
    }
    mutation.mutate({ kind: 'edit', body: patch });
  }

  const e = (k: string) => errors[k] ?? null;
  const coreDisabled = !coreEditable || mutation.isPending;

  return (
    <>
      <PageHeader
        title={job ? `Edit ${job.reference}` : 'New job'}
        description={job ? `${job.merchant_name} · ${job.bank?.name ?? ''}` : 'Create an inspection job for a bank. It starts as Pending until the scheduler confirms an appointment.'}
        back={job ? { href: `/jobs/${job.id}`, label: job.reference } : { href: '/jobs', label: 'Jobs' }}
        actions={job ? <StatusBadge status={job.status} /> : null}
      />

      {job && !coreEditable ? (
        <Alert variant={nothingEditable ? 'destructive' : 'warning'} className="mb-4">
          <Lock />
          <AlertTitle>
            {nothingEditable ? `This job is ${JOB_STATUS_LABEL[job.status].toLowerCase()} — it can no longer be edited` : `This job is ${JOB_STATUS_LABEL[job.status].toLowerCase()} — only the location type can change`}
          </AlertTitle>
          <AlertDescription>
            Merchant, address, map pin, MCC, contact, notes, attributes and geofence overrides can only change while a job is pending or scheduled (the
            agent works from the details that were current at allocation). The location type can change until the inspection starts.
          </AlertDescription>
        </Alert>
      ) : null}

      <form
        // The app validates every field itself (validate() + the server); native browser checks (e.g. type="email")
        // would block submit silently and leave stale errors on screen.
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!nothingEditable) submit();
        }}
        className="space-y-5"
      >
        <Card>
          <CardContent className="space-y-6 pt-4">
            <FormSection title="Bank and merchant">
              <FormGrid cols={3}>
                <FormField label="Bank" htmlFor="bank" required error={e('bank_id')}>
                  {job ? (
                    <Input id="bank" value={job.bank ? `${job.bank.code} — ${job.bank.name}` : job.bank_id} disabled />
                  ) : (
                    <BankSelect
                      id="bank"
                      value={s.bankId}
                      onChange={(v) => setS((prev) => ({ ...prev, bankId: v, attributes: {}, location_type: '' }))}
                      invalid={!!e('bank_id')}
                    />
                  )}
                </FormField>
                <FormField label="Merchant name" htmlFor="merchant_name" required error={e('merchant_name')}>
                  <Input id="merchant_name" value={s.merchant_name} onChange={(ev) => set('merchant_name', ev.target.value)} disabled={coreDisabled} aria-invalid={!!e('merchant_name') || undefined} maxLength={300} />
                </FormField>
                <FormField label="Trading name" htmlFor="trading_name" error={e('trading_name')}>
                  <Input id="trading_name" value={s.trading_name} onChange={(ev) => set('trading_name', ev.target.value)} disabled={coreDisabled} maxLength={300} />
                </FormField>
                <FormField label="External reference" htmlFor="external_ref" error={e('external_ref')} hint="The bank's own reference for this request.">
                  <Input id="external_ref" value={s.external_ref} onChange={(ev) => set('external_ref', ev.target.value)} disabled={coreDisabled} maxLength={120} />
                </FormField>
                <FormField
                  label="MCC"
                  htmlFor="mcc_code"
                  error={e('mcc_code')}
                  hint={
                    selectedMcc ? (
                      <span className="inline-flex items-center gap-1.5">
                        {selectedMcc.description} <Badge tone={RISK_TIER_TONE[selectedMcc.risk_tier]}>{selectedMcc.risk_tier} risk</Badge>
                      </span>
                    ) : (
                      'Merchant category code'
                    )
                  }
                >
                  <MccPicker id="mcc_code" value={s.mcc_code} onChange={(v) => set('mcc_code', v)} disabled={coreDisabled} invalid={!!e('mcc_code')} />
                </FormField>
              </FormGrid>
            </FormSection>

            <FormSection title="Address">
              <FormGrid cols={3}>
                {ADDRESS_FIELDS.map(([k, label]) => (
                  <FormField key={k} label={label} htmlFor={`address-${k}`} required={k === 'line1'} error={e(`address.${k}`)}>
                    <Input
                      id={`address-${k}`}
                      value={s.address[k]}
                      onChange={(ev) => setAddress(k, ev.target.value)}
                      disabled={coreDisabled}
                      aria-invalid={!!e(`address.${k}`) || undefined}
                    />
                  </FormField>
                ))}
              </FormGrid>
            </FormSection>

            <FormSection
              title="Location and geofence"
              description={coreEditable ? 'Click the map to place or move the merchant pin. The fence circle shows the radius the agent must be inside.' : undefined}
            >
              <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
                <div className="space-y-2">
                  <MapView
                    markers={markers}
                    circles={circles}
                    onMapClick={coreEditable ? (lat, lng) => setS((prev) => ({ ...prev, pin: { lat, lng }, pinTouched: true })) : undefined}
                    height={340}
                  />
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="size-4 text-blue-700" />
                    {s.pin ? <span>Pin: {formatLatLng(s.pin)}{s.pinTouched ? ' (moved — will be saved as pinned)' : job?.location_source ? ` (${humanize(job.location_source)})` : ''}</span> : <span>No pin yet</span>}
                    {s.pin && coreEditable ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setS((prev) => ({ ...prev, pin: null, pinTouched: true }))}>
                        <X /> Clear pin
                      </Button>
                    ) : null}
                    {bankCoords.value && coreEditable ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setS((prev) => ({ ...prev, pin: bankCoords.value, pinTouched: true }))}>
                        Use bank coordinates as pin
                      </Button>
                    ) : null}
                  </div>
                  {mismatchM !== null && mismatchM > MISMATCH_M ? (
                    <Alert variant="warning">
                      <AlertTriangle />
                      <AlertTitle>The pin is {Math.round(mismatchM)} m from the bank-supplied coordinates</AlertTitle>
                      <AlertDescription>
                        More than {MISMATCH_M} m apart, so the job will be flagged <strong>location mismatch</strong>. Check which location is right before
                        saving — the agent&apos;s geofence uses the pin.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </div>
                <div className="space-y-4">
                  <FormField label="Bank-supplied coordinates" error={e('address.bank_coordinates')} hint="Optional — as received from the bank (stored with the address).">
                    <div className="grid grid-cols-2 gap-2">
                      <Input aria-label="Bank latitude" placeholder="Latitude" inputMode="decimal" value={s.bankLat} onChange={(ev) => set('bankLat', ev.target.value)} disabled={coreDisabled} />
                      <Input aria-label="Bank longitude" placeholder="Longitude" inputMode="decimal" value={s.bankLng} onChange={(ev) => set('bankLng', ev.target.value)} disabled={coreDisabled} />
                    </div>
                  </FormField>
                  <FormField
                    label="Location type"
                    htmlFor="location_type"
                    required
                    error={e('location_type')}
                    hint={profileRadius ? `Profile: ${profileRadius} m fence, GPS accurate to ≤ ${profileAccuracy ?? '—'} m${profile?.prompt_checkin_on_arrival ? ', check-in on arrival' : ''}.` : undefined}
                  >
                    {ctx.isPending && s.bankId ? (
                      <Skeleton className="h-10 w-full" />
                    ) : (
                      <Select value={locationType} onValueChange={(v) => set('location_type', v)} disabled={!locationTypeEditable || mutation.isPending || !s.bankId}>
                        <SelectTrigger id="location_type" aria-invalid={!!e('location_type') || undefined}>
                          <SelectValue placeholder={s.bankId ? 'Choose a location type' : 'Choose a bank first'} />
                        </SelectTrigger>
                        <SelectContent>
                          {locationTypes.map((t) => {
                            const r = toNumber(ctx.data?.profiles?.[t]?.radius_m);
                            return (
                              <SelectItem key={t} value={t}>
                                {humanize(t)}
                                {r ? <span className="text-muted-foreground"> — {r} m</span> : null}
                                {t === ctx.data?.default_location_type ? <span className="text-muted-foreground"> (default)</span> : null}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    )}
                  </FormField>
                  <FormGrid cols={2}>
                    <FormField label="Fence radius (m)" htmlFor="radius" error={e('geofence_radius_m')} hint={`Override, 25–500. Default ${profileRadius ?? '—'} m.`}>
                      <Input id="radius" type="number" min={25} max={500} step={1} value={s.radius} onChange={(ev) => set('radius', ev.target.value)} disabled={coreDisabled} placeholder={profileRadius ? String(profileRadius) : ''} />
                    </FormField>
                    <FormField label="GPS accuracy (m)" htmlFor="accuracy" error={e('gps_accuracy_max_m')} hint={`Override, 5–200. Default ${profileAccuracy ?? '—'} m.`}>
                      <Input id="accuracy" type="number" min={5} max={200} step={1} value={s.accuracy} onChange={(ev) => set('accuracy', ev.target.value)} disabled={coreDisabled} placeholder={profileAccuracy ? String(profileAccuracy) : ''} />
                    </FormField>
                  </FormGrid>
                </div>
              </div>
            </FormSection>

            <FormSection title="Merchant contact and notes" description="Who the scheduler calls to arrange the visit.">
              <FormGrid cols={3}>
                <FormField label="Contact name" htmlFor="contact-name">
                  <Input id="contact-name" value={s.contactName} onChange={(ev) => set('contactName', ev.target.value)} disabled={coreDisabled} />
                </FormField>
                <FormField label="Contact phone" htmlFor="contact-phone">
                  <Input id="contact-phone" type="tel" value={s.contactPhone} onChange={(ev) => set('contactPhone', ev.target.value)} disabled={coreDisabled} />
                </FormField>
                <FormField label="Contact email" htmlFor="contact-email" error={e('contact.email')}>
                  <Input id="contact-email" type="email" value={s.contactEmail} onChange={(ev) => set('contactEmail', ev.target.value)} disabled={coreDisabled} aria-invalid={!!e('contact.email') || undefined} />
                </FormField>
              </FormGrid>
              <FormField label="Notes" htmlFor="notes" error={e('notes')} hint="Shown to the agent on the job briefing.">
                <Textarea id="notes" rows={3} value={s.notes} onChange={(ev) => set('notes', ev.target.value)} disabled={coreDisabled} maxLength={5000} />
              </FormField>
            </FormSection>

            <AttributesSection
              loading={job ? pinned.isPending && !!job.job_schema_version_id : ctx.isPending && !!s.bankId}
              hasBank={!!s.bankId}
              title={job ? 'Bank attributes (pinned job schema)' : 'Bank attributes'}
              empty={job && !job.job_schema_version_id ? 'No job schema was pinned on this job, so it has no bank attributes.' : 'This bank has no active job schema, so there are no extra attributes.'}
            >
              {attrs.length ? (
                <FormGrid cols={3}>
                  {attrs.map((def) => (
                    <FormField key={def.key} label={def.label} htmlFor={`attr-${def.key}`} required={def.required} error={e(`attributes.${def.key}`)} hint={attributeHint(def)}>
                      <AttributeInput
                        id={`attr-${def.key}`}
                        def={def}
                        value={s.attributes[def.key]}
                        onChange={(v) => setS((prev) => ({ ...prev, attributes: { ...prev.attributes, [def.key]: v } }))}
                        disabled={coreDisabled}
                        invalid={!!e(`attributes.${def.key}`)}
                      />
                    </FormField>
                  ))}
                </FormGrid>
              ) : null}
            </AttributesSection>
          </CardContent>
        </Card>

        <ApiErrorAlert error={mutation.error} title={isConflictError(mutation.error) ? 'The job changed while you were editing' : undefined} />

        <FormActions>
          <Button type="button" variant="outline" asChild>
            <Link href={job ? `/jobs/${job.id}` : '/jobs'}>Cancel</Link>
          </Button>
          {!nothingEditable && staff.isAdmin ? (
            <Button type="submit" loading={mutation.isPending}>
              {job ? 'Save changes' : 'Create job'}
            </Button>
          ) : null}
        </FormActions>
      </form>
    </>
  );
}

function AttributesSection({ loading, hasBank, title, empty, children }: { loading: boolean; hasBank: boolean; title: string; empty: string; children: ReactNode }) {
  return (
    <FormSection title={title} description="Defined by the bank's job schema (configuration, not code).">
      {!hasBank ? (
        <p className="text-sm text-muted-foreground">Choose a bank to see its attributes.</p>
      ) : loading ? (
        <Skeleton className="h-16 w-full" />
      ) : children ? (
        children
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </FormSection>
  );
}

/** /jobs/[id]/edit — loads the job, then renders the shared form. */
export function JobEditView({ id }: { id: string }) {
  const job = useJob(id);
  if (!isUuid(id)) return <ErrorState error={new Error('That is not a valid job id.')} />;
  if (job.isPending) return <PageSpinner label="Loading job…" />;
  if (job.error) return <ErrorState error={job.error} onRetry={() => void job.refetch()} />;
  if (!job.data) return <ErrorState error={new Error('Job not found, or it belongs to a bank outside your scope.')} title="Not found" />;
  // Re-mount when the row version changes so the form starts from fresh values.
  return <JobForm key={job.data.updated_at} mode="edit" job={job.data} />;
}
