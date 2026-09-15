'use client';

// Create / edit a trusted issuer (docs/07 §2, D-05). Everything about how a token is verified is configuration.
// Activation is a separate, reasoned action on the list — not part of this form.
// The request template and the employee-number source are edited as labelled fields (T2-25), in the shape read by
// supabase/functions/_shared/issuers.ts; keys this form doesn't know are kept untouched. Advanced view can edit
// either one as JSON.
import { KeyRound } from 'lucide-react';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { ActiveBadge } from '@/components/admin/admin-ui';
import { blankToNull, type Parsed, patchAdmin } from '@/components/admin/form-helpers';
import { ObjectEditor, type ObjectEditorState, objectEditorStateFrom, objectEditorStateToObject } from '@/components/admin/object-editor';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { apiFieldErrors, type FieldErrors, FormField, FormGrid, FormSection, zodFieldErrors } from '@/components/form-field';
import { JsonEditor, parseJsonText, stringifyJson } from '@/components/json-editor';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { adminApi } from '@/lib/api';
import { useMutationWithToast } from '@/lib/mutations';
import { useIsAdvanced } from '@/lib/preferences';
import { type IssuerCreateBody, issuerCreateSchema, issuerUpdateSchema } from '@/lib/schemas';
import { ISSUER_TYPES, type IssuerType, type JsonObject, type TrustedIssuer } from '@/lib/types';
import { cn, isPlainObject } from '@/lib/utils';

type TextField = 'issuer' | 'audience' | 'jwks_url' | 'introspection_url' | 'subject_claim' | 'secret_name';
type JsonField = 'request_template' | 'employee_number_source';
type IssuerField = TextField | JsonField;

export const ISSUER_TYPE_LABEL: Record<IssuerType, string> = {
  jwks: 'Checks a signature',
  introspection: 'Asks its server',
  dev_stub: 'Stand-in (QA only)',
};

const TYPE_HINT: Record<IssuerType, string> = {
  jwks: 'We check each sign-in’s signature against public keys the source publishes (JWKS).',
  introspection: 'We ask the source’s server about each sign-in. What to send and which answers to read are set below.',
  dev_stub: 'A stand-in sign-in source for QA and local testing only. Production never uses it. Its signing secret is stored on the server.',
};

const TYPE_FIELDS: Record<IssuerType, readonly IssuerField[]> = {
  jwks: ['issuer', 'audience', 'jwks_url', 'subject_claim', 'employee_number_source'],
  introspection: ['introspection_url', 'request_template', 'employee_number_source', 'secret_name'],
  dev_stub: ['issuer', 'audience', 'subject_claim', 'employee_number_source'],
};

const TEXT_FIELDS: { key: TextField; label: string; hint: string; mono?: boolean; placeholder?: string }[] = [
  { key: 'issuer', label: 'Source name in the sign-in (iss)', hint: 'Must match the iss value in every sign-in.' },
  { key: 'audience', label: 'Meant for (aud)', hint: 'Must match the aud value in every sign-in.' },
  { key: 'jwks_url', label: 'Public keys address (JWKS URL)', hint: 'Where the source publishes the keys we check signatures with.', placeholder: 'https://…' },
  { key: 'introspection_url', label: 'Check address (introspection URL)', hint: 'The address on the source’s server that we ask about each sign-in.', placeholder: 'https://…' },
  { key: 'subject_claim', label: 'Person ID value (subject claim)', hint: 'The value that holds the person’s permanent ID, usually sub.', mono: true },
];

const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,127}$/;
const METHODS = ['POST', 'GET', 'PUT'] as const;

// ── Request template (introspection) ───────────────────────────────────────────────────────────
interface TemplateState {
  mode: 'fields' | 'json';
  json: string;
  method: string;
  headers: ObjectEditorState;
  sendBody: boolean;
  body: ObjectEditorState;
  successPath: string;
  subjectPath: string;
  firstNamePath: string;
  lastNamePath: string;
  timeoutMs: string;
  /** Keys this form doesn't edit — kept as they are. */
  extra: JsonObject;
  namesExtra: JsonObject;
}

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

function templateStateFrom(t: JsonObject | null | undefined): TemplateState {
  const src = t ?? {};
  const { method, headers, body, success_path, subject_path, names, timeout_ms, ...extra } = src;
  const namesObj = isPlainObject(names) ? names : {};
  const { first_name, last_name, ...namesExtra } = namesObj;
  const bodyIsFields = body === undefined || isPlainObject(body);
  return {
    mode: 'fields',
    json: stringifyJson(src),
    method: typeof method === 'string' ? method : 'POST',
    headers: objectEditorStateFrom(isPlainObject(headers) ? headers : {}),
    sendBody: body !== undefined,
    body: objectEditorStateFrom(isPlainObject(body) ? body : {}),
    successPath: str(success_path),
    subjectPath: str(subject_path),
    firstNamePath: str(first_name),
    lastNamePath: str(last_name),
    timeoutMs: timeout_ms === undefined ? '' : str(timeout_ms),
    // A body that isn't a set of fields, or names that aren't an object, stay untouched in `extra`.
    extra: { ...extra, ...(bodyIsFields ? {} : { body }), ...(names !== undefined && !isPlainObject(names) ? { names } : {}) },
    namesExtra,
  };
}

function templateFromState(s: TemplateState): Parsed<JsonObject> {
  if (s.mode === 'json') {
    const r = parseJsonText(s.json || '{}', { requireObject: true });
    return r.ok && isPlainObject(r.value) ? { ok: true, value: r.value } : { ok: false, message: `What we send: ${r.ok ? 'must be a JSON object' : r.error.message}` };
  }
  const headers = objectEditorStateToObject(s.headers, {
    label: 'Headers',
    validate: (k, v) => (typeof v === 'string' ? null : `"${k}" must be text`),
  });
  if (!headers.ok) return headers;
  const out: JsonObject = { method: s.method || 'POST' };
  if (Object.keys(headers.value).length > 0) out.headers = headers.value;
  if (s.sendBody) {
    const body = objectEditorStateToObject(s.body, { label: 'Body' });
    if (!body.ok) return body;
    out.body = body.value;
  }
  if (s.successPath.trim()) out.success_path = s.successPath.trim();
  if (s.subjectPath.trim()) out.subject_path = s.subjectPath.trim();
  const names: JsonObject = { ...s.namesExtra };
  if (s.firstNamePath.trim()) names.first_name = s.firstNamePath.trim();
  if (s.lastNamePath.trim()) names.last_name = s.lastNamePath.trim();
  if (Object.keys(names).length > 0) out.names = names;
  const t = s.timeoutMs.trim();
  if (t) {
    if (!/^\d+$/.test(t) || Number(t) < 100 || Number(t) > 60000) return { ok: false, message: 'The wait time must be a whole number between 100 and 60 000 milliseconds.' };
    out.timeout_ms = Number(t);
  }
  return { ok: true, value: { ...out, ...s.extra } };
}

// ── Employee number source ─────────────────────────────────────────────────────────────────────
interface SourceState {
  mode: 'fields' | 'json';
  json: string;
  type: string;
  path: string;
  claim: string;
  extra: JsonObject;
}

function sourceStateFrom(o: JsonObject | null | undefined): SourceState {
  const src = o ?? {};
  const { type, path, claim, ...extra } = src;
  return { mode: 'fields', json: stringifyJson(src), type: str(type), path: str(path), claim: str(claim), extra };
}

function sourceFromState(s: SourceState, issuerType: IssuerType): Parsed<JsonObject> {
  if (s.mode === 'json') {
    const r = parseJsonText(s.json || '{}', { requireObject: true });
    return r.ok && isPlainObject(r.value) ? { ok: true, value: r.value } : { ok: false, message: `Employee number: ${r.ok ? 'must be a JSON object' : r.error.message}` };
  }
  const out: JsonObject = { ...s.extra };
  const type = issuerType === 'introspection' && !s.type ? 'issuer_lookup' : s.type;
  if (type) out.type = type;
  if (type !== 'none' && s.path.trim()) out.path = s.path.trim();
  if (s.claim.trim()) out.claim = s.claim.trim();
  if (issuerType === 'jwks' && type === 'claim' && !s.path.trim()) return { ok: false, message: 'Employee number: say which value in the sign-in holds it.' };
  if (issuerType === 'introspection' && !s.path.trim()) return { ok: false, message: 'Employee number: say which field in the source’s answer holds it.' };
  return { ok: true, value: out };
}

/** Fields / JSON switch shown in Advanced view (and whenever JSON mode is on). */
function ModeSwitch({ mode, onFields, onJson, fieldsBlocked, jsonBlocked }: { mode: 'fields' | 'json'; onFields: () => void; onJson: () => void; fieldsBlocked: boolean; jsonBlocked: boolean }) {
  const advanced = useIsAdvanced();
  if (!advanced && mode === 'fields') return null;
  const tab = (active: boolean) => cn('rounded px-3 py-1 disabled:opacity-50', active ? 'bg-card font-medium ring-1 ring-border' : 'text-muted-foreground hover:text-foreground');
  return (
    <div className="inline-flex rounded-md border bg-muted p-0.5 text-sm" role="tablist">
      <button type="button" role="tab" aria-selected={mode === 'fields'} className={tab(mode === 'fields')} disabled={fieldsBlocked} onClick={onFields}>
        Fields
      </button>
      <button type="button" role="tab" aria-selected={mode === 'json'} className={tab(mode === 'json')} disabled={jsonBlocked} onClick={onJson}>
        JSON
      </button>
    </div>
  );
}

function SubHeading({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

function RequestTemplateEditor({ state, onChange, error, uid }: { state: TemplateState; onChange: (s: TemplateState) => void; error?: string; uid: string }) {
  const built = templateFromState(state);
  const jsonOk = state.mode === 'json' && built.ok;
  return (
    <div className="grid gap-4 rounded-md border p-4">
      <SubHeading
        title="What we send to the source"
        hint={
          <>
            How we ask the source’s server about a sign-in. Write <code>{'{{token}}'}</code> where the sign-in goes and <code>{'{{secret}}'}</code> where
            the stored password goes. The server fills them in.
          </>
        }
        action={
          <ModeSwitch
            mode={state.mode}
            fieldsBlocked={state.mode === 'json' && !jsonOk}
            jsonBlocked={state.mode === 'fields' && !built.ok}
            onJson={() => built.ok && onChange({ ...state, mode: 'json', json: stringifyJson(built.value) })}
            onFields={() => built.ok && onChange({ ...templateStateFrom(built.value) })}
          />
        }
      />
      {state.mode === 'json' ? (
        <JsonEditor value={state.json} onChange={(json) => onChange({ ...state, json })} requireObject rows={12} />
      ) : (
        <>
          <FormGrid>
            <FormField label="Method" htmlFor={`${uid}-method`}>
              <Select value={state.method} onValueChange={(method) => onChange({ ...state, method })}>
                <SelectTrigger id={`${uid}-method`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...METHODS, state.method])].map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="How long to wait (milliseconds)" htmlFor={`${uid}-timeout`} hint="Leave empty for 8 000 (8 seconds).">
              <Input id={`${uid}-timeout`} type="number" inputMode="numeric" min={100} max={60000} step={100} value={state.timeoutMs} onChange={(e) => onChange({ ...state, timeoutMs: e.target.value })} placeholder="8000" />
            </FormField>
          </FormGrid>
          <div className="grid gap-2">
            <Label>Headers</Label>
            <ObjectEditor
              state={state.headers}
              onChange={(headers) => onChange({ ...state, headers })}
              label="Headers"
              fixedType="text"
              allowJson={false}
              keyLabel="Header"
              valueLabel="Value"
              keyPlaceholder="e.g. authorization"
              valuePlaceholder="e.g. Bearer {{secret}}"
              addLabel="Add header"
              emptyText="No headers. The server sends content-type: application/json."
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Switch id={`${uid}-send-body`} checked={state.sendBody} onCheckedChange={(sendBody) => onChange({ ...state, sendBody })} />
              <Label htmlFor={`${uid}-send-body`}>Send a request body</Label>
            </div>
            {state.sendBody ? (
              <ObjectEditor
                state={state.body}
                onChange={(body) => onChange({ ...state, body })}
                label="Body"
                allowJson={false}
                keyLabel="Body field"
                keyPlaceholder="e.g. token"
                valuePlaceholder="e.g. {{token}}"
                addLabel="Add body field"
                emptyText="An empty body ({})."
              />
            ) : null}
          </div>
          <FormGrid>
            <FormField label="Success field" htmlFor={`${uid}-success`} hint="A field that must be in the answer for the sign-in to count as valid. Use dots for nested fields, such as personnelNumber.">
              <Input id={`${uid}-success`} value={state.successPath} onChange={(e) => onChange({ ...state, successPath: e.target.value })} className="font-mono" />
            </FormField>
            <FormField label="Person ID field" htmlFor={`${uid}-subject`} hint="The field holding the person’s permanent ID. Leave empty to use the employee number field.">
              <Input id={`${uid}-subject`} value={state.subjectPath} onChange={(e) => onChange({ ...state, subjectPath: e.target.value })} className="font-mono" />
            </FormField>
            <FormField label="First name field" htmlFor={`${uid}-first`} hint="Optional, such as firstName.">
              <Input id={`${uid}-first`} value={state.firstNamePath} onChange={(e) => onChange({ ...state, firstNamePath: e.target.value })} className="font-mono" />
            </FormField>
            <FormField label="Last name field" htmlFor={`${uid}-last`} hint="Optional, such as surname.">
              <Input id={`${uid}-last`} value={state.lastNamePath} onChange={(e) => onChange({ ...state, lastNamePath: e.target.value })} className="font-mono" />
            </FormField>
          </FormGrid>
          {Object.keys(state.extra).length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Also kept unchanged: {Object.keys(state.extra).join(', ')}. Switch to Advanced view to see them as JSON.
            </p>
          ) : null}
        </>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function EmployeeNumberSourceEditor({ state, onChange, issuerType, error, uid }: { state: SourceState; onChange: (s: SourceState) => void; issuerType: IssuerType; error?: string; uid: string }) {
  const built = sourceFromState(state, issuerType);
  const jsonParse = state.mode === 'json' ? parseJsonText(state.json || '{}', { requireObject: true }) : null;
  const type = issuerType === 'introspection' && !state.type ? 'issuer_lookup' : state.type || (issuerType === 'jwks' ? 'none' : '');
  return (
    <div className="grid gap-4 rounded-md border p-4">
      <SubHeading
        title="Employee number"
        hint="Where we read the person’s checked employee number: a value in the sign-in, or a field in the source’s answer. Never from what the phone app says."
        action={
          <ModeSwitch
            mode={state.mode}
            fieldsBlocked={state.mode === 'json' && !jsonParse?.ok}
            jsonBlocked={false}
            onJson={() => onChange({ ...state, mode: 'json', json: stringifyJson(built.ok ? built.value : { ...state.extra, ...(state.type ? { type: state.type } : {}), ...(state.path ? { path: state.path } : {}), ...(state.claim ? { claim: state.claim } : {}) }) })}
            onFields={() => jsonParse?.ok && isPlainObject(jsonParse.value) && onChange(sourceStateFrom(jsonParse.value))}
          />
        }
      />
      {state.mode === 'json' ? (
        <JsonEditor value={state.json} onChange={(json) => onChange({ ...state, json })} requireObject rows={5} />
      ) : issuerType === 'dev_stub' ? (
        <FormField label="Value in the sign-in" htmlFor={`${uid}-ens-claim`} hint="Which value in the stand-in sign-in holds the employee number. Leave empty for employee_number.">
          <Input id={`${uid}-ens-claim`} value={state.claim} onChange={(e) => onChange({ ...state, claim: e.target.value })} placeholder="employee_number" className="font-mono" />
        </FormField>
      ) : issuerType === 'jwks' ? (
        <FormGrid>
          <FormField label="Comes from" htmlFor={`${uid}-ens-type`}>
            <Select value={type} onValueChange={(v) => onChange({ ...state, type: v })}>
              <SelectTrigger id={`${uid}-ens-type`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claim">A value in the sign-in</SelectItem>
                <SelectItem value="none">This source doesn’t provide it</SelectItem>
                {type && type !== 'claim' && type !== 'none' ? <SelectItem value={type}>{type}</SelectItem> : null}
              </SelectContent>
            </Select>
          </FormField>
          {type === 'claim' ? (
            <FormField label="Value name" htmlFor={`${uid}-ens-path`} hint="Use dots for nested values, such as employee_number.">
              <Input id={`${uid}-ens-path`} value={state.path} onChange={(e) => onChange({ ...state, path: e.target.value })} className="font-mono" />
            </FormField>
          ) : null}
        </FormGrid>
      ) : (
        <FormField label="Field in the source’s answer" htmlFor={`${uid}-ens-path`} hint="Use dots for nested fields, such as personnelNumber.">
          <Input id={`${uid}-ens-path`} value={state.path} onChange={(e) => onChange({ ...state, path: e.target.value })} className="font-mono" />
        </FormField>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function IssuerSheet({ open, issuer, onOpenChange }: { open: boolean; issuer: TrustedIssuer | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg">{open ? <IssuerForm key={issuer?.id ?? 'new'} issuer={issuer} onDone={() => onOpenChange(false)} /> : null}</SheetContent>
    </Sheet>
  );
}

type IssuerSave = { kind: 'create'; body: IssuerCreateBody } | { kind: 'update'; id: string; body: Record<string, unknown> };

function IssuerForm({ issuer, onDone }: { issuer: TrustedIssuer | null; onDone: () => void }) {
  const uid = useId();
  const isNew = issuer === null;
  const [key, setKey] = useState(issuer?.key ?? '');
  const [type, setType] = useState<IssuerType>(issuer?.type ?? 'jwks');
  const [title, setTitle] = useState(issuer?.title ?? '');
  const [primary, setPrimary] = useState(issuer?.primary_issuer ?? false);
  const [text, setText] = useState<Record<TextField, string>>({
    issuer: issuer?.issuer ?? '',
    audience: issuer?.audience ?? '',
    jwks_url: issuer?.jwks_url ?? '',
    introspection_url: issuer?.introspection_url ?? '',
    subject_claim: issuer?.subject_claim ?? '',
    secret_name: issuer?.secret_name ?? '',
  });
  const [template, setTemplate] = useState<TemplateState>(() => templateStateFrom(issuer?.request_template));
  const [source, setSource] = useState<SourceState>(() => sourceStateFrom(issuer?.employee_number_source));
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});

  const mutation = useMutationWithToast({
    mutationFn: (save: IssuerSave) =>
      save.kind === 'create'
        ? adminApi.issuers.create(save.body)
        : // patchAdmin so a cleared field is sent as null (the shared body type turns blanks into "unchanged").
          patchAdmin<TrustedIssuer>(`/issuers/${encodeURIComponent(save.id)}`, save.body),
    invalidate: [['trusted_issuers']],
    toastErrors: false,
    successMessage: (i, save) => (save.kind === 'create' ? `${i.title} added. It stays off until you turn it on from the list.` : `${i.title} saved.`),
    onSuccess: () => onDone(),
  });
  const errors: FieldErrors = { ...apiFieldErrors(mutation.error), ...clientErrors };
  const fields = TYPE_FIELDS[type];
  const has = (f: IssuerField) => fields.includes(f);

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: FieldErrors = {};
    const jsonValues: Partial<Record<JsonField, JsonObject>> = {};
    if (has('request_template')) {
      const r = templateFromState(template);
      if (r.ok) jsonValues.request_template = r.value;
      else next.request_template = r.message;
    }
    if (has('employee_number_source')) {
      const r = sourceFromState(source, type);
      if (r.ok) jsonValues.employee_number_source = r.value;
      else next.employee_number_source = r.message;
    }
    const secretName = text.secret_name.trim();
    if (has('secret_name') && secretName && !SECRET_NAME_RE.test(secretName)) {
      next.secret_name = 'Enter the secret’s name in capitals with underscores (ISSUER_CREDENTIAL, for example), never the secret itself.';
    }
    const textValues: Partial<Record<TextField, string>> = {};
    for (const f of ['issuer', 'audience', 'jwks_url', 'introspection_url', 'subject_claim', 'secret_name'] as const) {
      if (has(f)) textValues[f] = text[f];
    }
    const input = { type, title, primary_issuer: primary, ...textValues, ...jsonValues };

    if (isNew) {
      const parsed = issuerCreateSchema.safeParse({ key: key.trim(), ...input });
      const merged = parsed.success ? next : { ...zodFieldErrors(parsed.error), ...next };
      setClientErrors(merged);
      if (!parsed.success || Object.keys(merged).length > 0) return;
      mutation.mutate({ kind: 'create', body: parsed.data });
      return;
    }
    const parsed = issuerUpdateSchema.safeParse(input);
    const merged = parsed.success ? next : { ...zodFieldErrors(parsed.error), ...next };
    setClientErrors(merged);
    if (!parsed.success || Object.keys(merged).length > 0) return;
    const body: Record<string, unknown> = { type, title: title.trim(), primary_issuer: primary, ...jsonValues };
    for (const [f, v] of Object.entries(textValues)) body[f] = blankToNull(v);
    mutation.mutate({ kind: 'update', id: issuer.id, body });
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader>
        <SheetTitle>{isNew ? 'Add a sign-in source' : issuer.title}</SheetTitle>
        <SheetDescription>How we check that an agent is who they say they are when they sign in, and how we find their employee number.</SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-6">
        {!isNew ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Status</span>
            <ActiveBadge active={issuer.active} activeLabel="On" inactiveLabel="Off" />
            <span className="text-muted-foreground">Turn it on or off from the list. Each change needs a reason.</span>
          </div>
        ) : (
          <Alert variant="info">
            <KeyRound />
            <AlertDescription>A new sign-in source starts turned off. Turn it on from the list once it’s set up and its secret is stored on the server.</AlertDescription>
          </Alert>
        )}
        <FormSection title="About this source">
          <FormGrid>
            <FormField
              label="Key"
              htmlFor={`${uid}-key`}
              required={isNew}
              error={errors.key}
              hint={isNew ? 'A short internal name in lower case with underscores, such as partner_idp. It can’t be changed later.' : 'The key can’t be changed.'}
            >
              <Input id={`${uid}-key`} value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} readOnly={!isNew} className="font-mono" maxLength={64} aria-invalid={!!errors.key || undefined} />
            </FormField>
            <FormField label="How we check sign-ins" htmlFor={`${uid}-type`} required error={errors.type} hint={TYPE_HINT[type]}>
              <Select value={type} onValueChange={(v) => setType(v as IssuerType)}>
                <SelectTrigger id={`${uid}-type`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ISSUER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ISSUER_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </FormGrid>
          <FormField label="Name" htmlFor={`${uid}-title`} required error={errors.title}>
            <Input id={`${uid}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-invalid={!!errors.title || undefined} />
          </FormField>
          <div className="flex items-start gap-3">
            <Switch id={`${uid}-primary`} checked={primary} onCheckedChange={setPrimary} />
            <div className="grid gap-0.5">
              <Label htmlFor={`${uid}-primary`}>Can sign agents in on its own</Label>
              <p className="text-sm text-muted-foreground">If this is off, the source only adds an extra check alongside another one.</p>
            </div>
          </div>
        </FormSection>

        <FormSection title="Checking sign-ins" description="Only the settings this kind of source needs are shown.">
          <FormGrid>
            {TEXT_FIELDS.filter((f) => has(f.key)).map((f) => (
              <FormField key={f.key} label={f.label} htmlFor={`${uid}-${f.key}`} error={errors[f.key]} hint={f.hint}>
                <Input
                  id={`${uid}-${f.key}`}
                  value={text[f.key]}
                  onChange={(e) => setText((t) => ({ ...t, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className={f.mono ? 'font-mono' : undefined}
                  aria-invalid={!!errors[f.key] || undefined}
                />
              </FormField>
            ))}
          </FormGrid>
          {has('secret_name') ? (
            <FormField
              label="Secret name"
              htmlFor={`${uid}-secret`}
              error={errors.secret_name}
              hint="The name of the stored server secret that holds the password for this check. Never paste the password itself: a developer stores it on the server."
            >
              <Input
                id={`${uid}-secret`}
                value={text.secret_name}
                onChange={(e) => setText((t) => ({ ...t, secret_name: e.target.value.toUpperCase() }))}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!errors.secret_name || undefined}
              />
            </FormField>
          ) : null}
          {has('request_template') ? <RequestTemplateEditor state={template} onChange={setTemplate} error={errors.request_template} uid={uid} /> : null}
          {has('employee_number_source') ? <EmployeeNumberSourceEditor state={source} onChange={setSource} issuerType={type} error={errors.employee_number_source} uid={uid} /> : null}
        </FormSection>
        <ApiErrorAlert error={mutation.error} />
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          {isNew ? 'Add sign-in source' : 'Save changes'}
        </Button>
      </SheetFooter>
    </form>
  );
}
