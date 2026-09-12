// Zod schemas for every /v1/admin request body (admin-api-contract). Forms parse with these; the API helpers
// in lib/api.ts take the inferred *output* types (`XxxBody`). Empty optional text inputs become undefined.
import { z } from 'zod';
import {
  ACTIVATION_INCOMPATIBLE_POLICIES,
  CONFIG_LAYERS,
  CONTACT_CHANNELS,
  CONTACT_OUTCOMES,
  DEACTIVATION_MODES,
  DEFINITION_KINDS,
  EXPORT_TYPES,
  ISSUER_TYPES,
  LOCATION_SOURCES,
  MCC_RISK_TIERS,
  PERMISSIONS,
  POS_ROLES,
  REASON_CATEGORIES,
  RELEASE_STATUSES,
  REVIEW_DECISIONS,
} from './types';

// ── Building blocks ────────────────────────────────────────────────────────────────────────────
export const KEY_REGEX = /^[a-z][a-z0-9_]{1,63}$/;
export const BANK_CODE_REGEX = /^[A-Z0-9_]{2,16}$/;
export const EMPLOYEE_NUMBER_REGEX = /^[A-Za-z0-9-]{1,32}$/;
export const MCC_REGEX = /^[0-9]{4}$/;
export const SEMVER_REGEX = /^[0-9]+\.[0-9]+\.[0-9]+([-+].*)?$/;

export const uuidSchema = z.string().uuid('Must be a valid UUID');
/** Required, trimmed, non-empty text. */
export const requiredText = (label = 'This field') => z.string().trim().min(1, `${label} is required`);
/** Optional text: '' / whitespace becomes undefined. */
export const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));
/** Optional email: '' becomes undefined. */
export const optionalEmail = z
  .union([z.literal(''), z.string().trim().email('Must be a valid email address')])
  .optional()
  .transform((v) => (v ? v : undefined));
/** Optional URL: '' becomes undefined. */
export const optionalUrl = z
  .union([z.literal(''), z.string().trim().url('Must be a valid URL')])
  .optional()
  .transform((v) => (v ? v : undefined));
export const isoDateTimeSchema = z
  .string()
  .min(1, 'Date and time is required')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Must be a valid date and time');
export const jsonObjectSchema = z.record(z.string(), z.unknown());
export const keySchema = z.string().regex(KEY_REGEX, 'Lowercase letters, digits and _, starting with a letter (2–64)');
export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
/** `{ reason }` — sessions/devices revoke & restore, issuer toggle, server-epoch rotate, reactivate, link revoke. */
export const reasonBodySchema = z.object({ reason: requiredText('Reason') });
export type ReasonBody = z.infer<typeof reasonBodySchema>;

// ── Banks ──────────────────────────────────────────────────────────────────────────────────────
export const bankContactSchema = z.object({
  name: requiredText('Name'),
  role: optionalText,
  email: optionalEmail,
  phone: optionalText,
});
export const billingSettingsSchema = z.record(
  z.string(),
  z.object({ default: z.boolean().optional(), codes: z.record(z.string(), z.boolean()).optional() }),
);
const bankFields = {
  name: requiredText('Name').pipe(z.string().max(200)),
  active: z.boolean().optional(),
  contacts: z.array(bankContactSchema).optional(),
  export_settings: jsonObjectSchema.optional(),
  billing_settings: billingSettingsSchema.optional(),
  four_eyes_enabled: z.boolean().optional(),
};
export const bankCreateSchema = z.object({
  code: z.string().trim().regex(BANK_CODE_REGEX, '2–16 characters: A–Z, 0–9 and _'),
  ...bankFields,
});
export const bankUpdateSchema = z.object(bankFields).partial();
export type BankCreateBody = z.infer<typeof bankCreateSchema>;
export type BankUpdateBody = z.infer<typeof bankUpdateSchema>;

// ── Users ──────────────────────────────────────────────────────────────────────────────────────
export const userCreateSchema = z.object({
  employee_number: z.string().trim().regex(EMPLOYEE_NUMBER_REGEX, '1–32 characters: letters, digits and -'),
  first_name: requiredText('First name'),
  last_name: requiredText('Last name'),
  email: optionalEmail,
  phone: optionalText,
  role: z.enum(POS_ROLES),
  permissions: z.array(z.enum(PERMISSIONS)).optional(),
  bank_ids: z.array(uuidSchema).nullable().optional(),
  attributes: jsonObjectSchema.optional(),
});
export const userUpdateSchema = userCreateSchema.omit({ employee_number: true }).partial();
export const userDeactivateSchema = z
  .object({ mode: z.enum(DEACTIVATION_MODES), reason: z.string().trim() })
  .superRefine((v, ctx) => {
    if (v.mode === 'hard_revoke' && v.reason.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'A reason is required for a hard revoke' });
    }
  });
export const adminLoginSchema = z.object({ email: z.string().trim().email('Must be a valid email address') });
export const userPhotoSchema = z.object({
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  data_base64: z.string().min(1),
});
export type UserCreateBody = z.infer<typeof userCreateSchema>;
export type UserUpdateBody = z.infer<typeof userUpdateSchema>;
export type UserDeactivateBody = z.infer<typeof userDeactivateSchema>;
export type AdminLoginBody = z.infer<typeof adminLoginSchema>;
export type UserPhotoBody = z.infer<typeof userPhotoSchema>;

// ── Trusted issuers & identity links ───────────────────────────────────────────────────────────
export const issuerCreateSchema = z.object({
  key: keySchema,
  type: z.enum(ISSUER_TYPES),
  title: requiredText('Title'),
  issuer: optionalText,
  audience: optionalText,
  jwks_url: optionalUrl,
  introspection_url: optionalUrl,
  request_template: jsonObjectSchema.optional(),
  subject_claim: optionalText,
  employee_number_source: jsonObjectSchema.optional(),
  secret_name: optionalText,
  primary_issuer: z.boolean().optional(),
  active: z.boolean().optional(),
});
export const issuerUpdateSchema = issuerCreateSchema.omit({ key: true }).partial();
export const issuerActiveSchema = z.object({ active: z.boolean(), reason: requiredText('Reason') });
export const identityLinkCreateSchema = z.object({
  user_id: uuidSchema,
  issuer_key: requiredText('Issuer'),
  subject: requiredText('Subject'),
});
export type IssuerCreateBody = z.infer<typeof issuerCreateSchema>;
export type IssuerUpdateBody = z.infer<typeof issuerUpdateSchema>;
export type IssuerActiveBody = z.infer<typeof issuerActiveSchema>;
export type IdentityLinkCreateBody = z.infer<typeof identityLinkCreateSchema>;

// ── Reference data ─────────────────────────────────────────────────────────────────────────────
export const reasonCodeCreateSchema = z.object({
  category: z.enum(REASON_CATEGORIES),
  code: z.string().trim().regex(KEY_REGEX, 'Lowercase letters, digits and _, starting with a letter'),
  label: requiredText('Label'),
  description: optionalText,
  requires_note: z.boolean().optional(),
  requires_photo: z.boolean().optional(),
  billable: z.boolean().optional(),
  bank_id: uuidSchema.nullable().optional(),
  sort_order: z.number().int().optional(),
});
export const reasonCodeUpdateSchema = z.object({
  label: requiredText('Label').optional(),
  description: optionalText,
  requires_note: z.boolean().optional(),
  requires_photo: z.boolean().optional(),
  billable: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  active: z.boolean().optional(),
});
export const mccCreateSchema = z.object({
  code: z.string().trim().regex(MCC_REGEX, 'Four digits'),
  description: requiredText('Description'),
  risk_tier: z.enum(MCC_RISK_TIERS).optional(),
});
export const mccUpdateSchema = z.object({
  description: requiredText('Description').optional(),
  risk_tier: z.enum(MCC_RISK_TIERS).optional(),
  active: z.boolean().optional(),
});
export const lookupListCreateSchema = z.object({
  key: keySchema,
  bank_id: uuidSchema.nullable().optional(),
  title: requiredText('Title'),
});
export const lookupListUpdateSchema = z.object({ title: requiredText('Title') });
export const lookupItemSchema = z.object({
  value: z.string().min(1, 'Value is required'),
  label: z.string().min(1, 'Label is required'),
  meta: jsonObjectSchema.optional(),
});
export const lookupListVersionSchema = z
  .object({ items: z.array(lookupItemSchema) })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.items.forEach((item, i) => {
      if (seen.has(item.value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', i, 'value'], message: `Duplicate value "${item.value}"` });
      }
      seen.add(item.value);
    });
  });
export const declarationSchema = z.object({
  key: keySchema,
  title: requiredText('Title'),
  text: requiredText('Text'),
});
export const releaseCreateSchema = z.object({
  version: z.string().trim().regex(SEMVER_REGEX, 'Semantic version, e.g. 1.4.0'),
  released_at: isoDateTimeSchema.optional(),
  status: z.enum(RELEASE_STATUSES).optional(),
  api_versions: z.array(z.string().min(1)).optional(),
  spec_range: requiredText('Spec range'),
  components: jsonObjectSchema.optional(),
  page_types: jsonObjectSchema.optional(),
  notes: optionalText,
});
export const releaseUpdateSchema = releaseCreateSchema.omit({ version: true, released_at: true }).partial();
export type ReasonCodeCreateBody = z.infer<typeof reasonCodeCreateSchema>;
export type ReasonCodeUpdateBody = z.infer<typeof reasonCodeUpdateSchema>;
export type MccCreateBody = z.infer<typeof mccCreateSchema>;
export type MccUpdateBody = z.infer<typeof mccUpdateSchema>;
export type LookupListCreateBody = z.infer<typeof lookupListCreateSchema>;
export type LookupListUpdateBody = z.infer<typeof lookupListUpdateSchema>;
export type LookupListVersionBody = z.infer<typeof lookupListVersionSchema>;
export type DeclarationBody = z.infer<typeof declarationSchema>;
export type ReleaseCreateBody = z.infer<typeof releaseCreateSchema>;
export type ReleaseUpdateBody = z.infer<typeof releaseUpdateSchema>;

// ── Remote config ──────────────────────────────────────────────────────────────────────────────
export const configValidateSchema = z.object({ values: jsonObjectSchema });
export const configPublishSchema = z
  .object({
    layer: z.enum(CONFIG_LAYERS),
    subject_id: uuidSchema.nullable().optional(),
    values: jsonObjectSchema,
    reason: requiredText('Reason'),
    effective_from: isoDateTimeSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.layer === 'global' && v.subject_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subject_id'], message: 'The global layer has no subject' });
    }
    if (v.layer !== 'global' && !v.subject_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subject_id'], message: `Choose the ${v.layer} this applies to` });
    }
  });
export interface ConfigResolvedQuery {
  user_id?: string;
  device_id?: string;
  bank_id?: string;
}
export type ConfigValidateBody = z.infer<typeof configValidateSchema>;
export type ConfigPublishBody = z.infer<typeof configPublishSchema>;

// ── Definitions studio ─────────────────────────────────────────────────────────────────────────
export const familyCreateSchema = z.object({
  kind: z.enum(DEFINITION_KINDS),
  key: keySchema,
  bank_id: uuidSchema.nullable().optional(),
  title: requiredText('Title'),
  description: optionalText,
});
export const familyUpdateSchema = z.object({ title: requiredText('Title').optional(), description: optionalText });
export const analyseSchema = z.object({ definition: jsonObjectSchema.optional() });
export const definitionPublishSchema = z.object({ definition: jsonObjectSchema.optional(), note: optionalText });
export const audienceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('agents'), user_ids: z.array(uuidSchema).min(1, 'Choose at least one agent') }),
  z.object({ type: z.literal('percent'), percent: z.number().int().min(1).max(100) }),
  z.object({
    type: z.literal('attribute'),
    key: requiredText('Attribute key'),
    values: z.array(z.string().min(1)).min(1, 'Give at least one value'),
  }),
]);
export const activationSchema = z
  .object({
    version_id: uuidSchema,
    audience: audienceSchema,
    policy: z.object({ incompatible: z.enum(ACTIVATION_INCOMPATIBLE_POLICIES) }).optional(),
    effective_from: isoDateTimeSchema.optional(),
    effective_to: isoDateTimeSchema.nullable().optional(),
    reason: requiredText('Reason'),
  })
  .superRefine((v, ctx) => {
    if (v.effective_from && v.effective_to && Date.parse(v.effective_to) <= Date.parse(v.effective_from)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['effective_to'], message: 'Must be after the start' });
    }
  });
export const testCaseCreateSchema = z.object({
  name: requiredText('Name'),
  context: jsonObjectSchema.optional(),
  steps: z.array(z.unknown()).optional(),
  expectations: jsonObjectSchema.optional(),
});
export const testCaseUpdateSchema = testCaseCreateSchema.partial();
export const approvalDecideSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'withdrawn']),
  note: optionalText,
});
export type FamilyCreateBody = z.infer<typeof familyCreateSchema>;
export type FamilyUpdateBody = z.infer<typeof familyUpdateSchema>;
export type AnalyseBody = z.infer<typeof analyseSchema>;
export type DefinitionPublishBody = z.infer<typeof definitionPublishSchema>;
export type AudienceBody = z.infer<typeof audienceSchema>;
export type ActivationBody = z.infer<typeof activationSchema>;
export type TestCaseCreateBody = z.infer<typeof testCaseCreateSchema>;
export type TestCaseUpdateBody = z.infer<typeof testCaseUpdateSchema>;
export type ApprovalDecideBody = z.infer<typeof approvalDecideSchema>;

// ── Jobs ───────────────────────────────────────────────────────────────────────────────────────
export const addressSchema = z.object({
  line1: requiredText('Address line 1'),
  line2: optionalText,
  suburb: optionalText,
  city: optionalText,
  province: optionalText,
  postal_code: optionalText,
  country: optionalText,
});
export const jobContactSchema = z.object({ name: optionalText, phone: optionalText, email: optionalEmail });
const jobFields = {
  merchant_name: requiredText('Merchant name').pipe(z.string().max(300)),
  trading_name: optionalText,
  external_ref: optionalText,
  address: addressSchema,
  location: latLngSchema.nullable().optional(),
  location_source: z.enum(LOCATION_SOURCES).optional(),
  location_type: z.string().regex(KEY_REGEX, 'Must be a geofence profile key').optional(),
  mcc_code: z.string().regex(MCC_REGEX, 'Four digits').optional(),
  contact: jobContactSchema.optional(),
  notes: optionalText,
  attributes: jsonObjectSchema.optional(),
  geofence_radius_m: z.number().int().min(25).max(500).optional(),
  gps_accuracy_max_m: z.number().int().min(5).max(200).optional(),
  parent_job_id: uuidSchema.optional(),
};
export const jobCreateSchema = z.object({ bank_id: uuidSchema, ...jobFields });
export const jobUpdateSchema = z.object(jobFields).partial();
/** One import row (a POST /jobs body without bank_id) — optional client-side pre-validation. */
export const jobImportRowSchema = z.object(jobFields);
/** Rows are sent as-is; the server validates each and reports per-row errors (use dry_run first). */
export const jobImportSchema = z.object({
  bank_id: uuidSchema,
  rows: z.array(jsonObjectSchema).min(1, 'No rows to import').max(500, 'At most 500 rows per import'),
  dry_run: z.boolean().optional(),
});
export const contactAttemptSchema = z.object({
  attempted_at: isoDateTimeSchema.optional(),
  channel: z.enum(CONTACT_CHANNELS),
  outcome: z.enum(CONTACT_OUTCOMES),
  proposed_start: isoDateTimeSchema.optional(),
  proposed_end: isoDateTimeSchema.optional(),
  contact_name: optionalText,
  note: optionalText,
});
export const onsiteContactSchema = z.object({
  name: requiredText('Contact name'),
  phone: optionalText,
  email: optionalEmail,
  role: optionalText,
});
export const scheduleSchema = z
  .object({
    scheduled_start: isoDateTimeSchema,
    scheduled_end: isoDateTimeSchema,
    onsite_contact: onsiteContactSchema,
    note: optionalText,
  })
  .superRefine((v, ctx) => {
    if (Date.parse(v.scheduled_end) <= Date.parse(v.scheduled_start)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduled_end'], message: 'End must be after start' });
    }
  });
/** `{ reason_code, note? }` — unschedule, not-secured, revoke, cancel. Enforce requires_note in the form. */
export const reasonCodeActionSchema = z.object({ reason_code: requiredText('Reason'), note: optionalText });
export const allocateSchema = z.object({ agent_id: uuidSchema, note: optionalText });
export const reassignSchema = z.object({ agent_id: uuidSchema, reason_code: requiredText('Reason'), note: optionalText });
export const closeSchema = z.object({ note: optionalText });
export type AddressBody = z.infer<typeof addressSchema>;
export type JobCreateBody = z.infer<typeof jobCreateSchema>;
export type JobUpdateBody = z.infer<typeof jobUpdateSchema>;
export type JobImportRowBody = z.infer<typeof jobImportRowSchema>;
export type JobImportBody = z.infer<typeof jobImportSchema>;
export type ContactAttemptBody = z.infer<typeof contactAttemptSchema>;
export type ScheduleBody = z.infer<typeof scheduleSchema>;
export type ReasonCodeActionBody = z.infer<typeof reasonCodeActionSchema>;
export type AllocateBody = z.infer<typeof allocateSchema>;
export type ReassignBody = z.infer<typeof reassignSchema>;
export type CloseBody = z.infer<typeof closeSchema>;

// ── Review ─────────────────────────────────────────────────────────────────────────────────────
export const reviewSchema = z
  .object({
    decision: z.enum(REVIEW_DECISIONS),
    reason_code: optionalText,
    note: optionalText,
    override_acknowledged: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision !== 'approved' && !v.reason_code) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason_code'], message: 'Choose a reason' });
    }
    if (v.decision === 'returned' && !v.note) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'Tell the agent what to fix' });
    }
  });
export const amendmentSchema = z.object({
  field_key: requiredText('Field'),
  new_value: z.unknown(),
  justification: requiredText('Justification'),
});
export type ReviewBody = z.infer<typeof reviewSchema>;
export type AmendmentBody = z.infer<typeof amendmentSchema>;

// ── Envelope inbox ─────────────────────────────────────────────────────────────────────────────
export const envelopeReprocessSchema = z.object({ note: requiredText('Note') });
export const envelopeResolveSchema = z
  .object({
    resolution: z.enum(['resolved', 'attached']),
    note: requiredText('Note'),
    job_id: uuidSchema.optional(),
    reason_code: optionalText,
  })
  .superRefine((v, ctx) => {
    if (v.resolution === 'attached' && !v.job_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['job_id'], message: 'Choose the job to attach to' });
    }
  });
export type EnvelopeReprocessBody = z.infer<typeof envelopeReprocessSchema>;
export type EnvelopeResolveBody = z.infer<typeof envelopeResolveSchema>;

// ── Operations ─────────────────────────────────────────────────────────────────────────────────
export const alertsAckSchema = z.object({ ids: z.array(uuidSchema).min(1, 'Select at least one alert') });
export const exportScopeSchema = z.object({
  bank_id: uuidSchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  job_ids: z.array(uuidSchema).optional(),
  family_id: uuidSchema.optional(),
  version_id: uuidSchema.optional(),
});
export const exportCreateSchema = z.object({
  type: z.enum(EXPORT_TYPES),
  scope: exportScopeSchema,
  recipient: optionalText,
});
export type AlertsAckBody = z.infer<typeof alertsAckSchema>;
export type ExportCreateBody = z.infer<typeof exportCreateSchema>;

// ── Dev tools (outside /admin) ─────────────────────────────────────────────────────────────────
export const devHostTokenSchema = z.object({
  user_id: uuidSchema,
  ttl_seconds: z.number().int().positive().optional(),
});
export const authExchangeSchema = z.object({
  issuer: z.literal('pos_dev'),
  token: z.string().min(1),
  issued_at: z.union([z.string(), z.number()]),
  device: z.object({
    device_id: uuidSchema,
    client_type: z.literal('web'),
    platform: z.literal('admin-devtools'),
  }),
});
export type DevHostTokenBody = z.infer<typeof devHostTokenSchema>;
export type AuthExchangeBody = z.infer<typeof authExchangeSchema>;
