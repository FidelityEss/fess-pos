// Sample data the phone previews render with (a realistic job, agent and home-tile totals). Mirrors the shape the module
// builds for rules and bindings (context_snapshot: today, job, agent, inspection, stats — docs/04 §4.4).

export interface PreviewJob {
  id: string;
  reference: string;
  status: string;
  merchant_name: string;
  address: { line1: string; suburb?: string; city?: string; province?: string; postal_code?: string };
  location: { lat: number; lng: number };
  location_type: string;
  mcc: { code: string; description: string };
  bank: { id: string; code: string; name: string };
  attributes: Record<string, unknown>;
  scheduled: { start: string; end: string };
  onsite_contact: { name: string; phone: string };
  notes: string | null;
}

export interface PreviewContext {
  today: string;
  job: PreviewJob;
  agent: { id: string; employee_number: string; first_name: string; last_name: string; attributes: Record<string, unknown> };
  inspection: { attempt: number; geofence: { inside: boolean; method: string; profile: string; relaxed: boolean; override: boolean } };
  stats: Record<string, number>;
  previous: null;
}

function todayAt(h: number, m = 0): string {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

export function samplePreviewContext(overrides: Partial<PreviewContext> = {}): PreviewContext {
  const today = new Date().toISOString().slice(0, 10);
  return {
    today,
    job: {
      id: '00000000-0000-4000-8000-000000000042',
      reference: 'POS-2026-000042',
      status: 'assigned',
      merchant_name: "Mama Joy's Spaza",
      address: { line1: '1187 Vilakazi St', suburb: 'Orlando West', city: 'Soweto', province: 'Gauteng', postal_code: '1804' },
      location: { lat: -26.2385, lng: 27.9087 },
      location_type: 'residential',
      mcc: { code: '5411', description: 'Grocery stores and supermarkets' },
      bank: { id: '00000000-0000-4000-8000-0000000000b1', code: 'UBNK', name: 'Ubuntu Bank' },
      attributes: { branch_code: '250655', account_manager: 'Nomsa Zulu', risk_tier: 'standard' },
      scheduled: { start: todayAt(10), end: todayAt(12) },
      onsite_contact: { name: 'Joyce Mthembu', phone: '+27 82 345 0011' },
      notes: 'Owner prefers a morning visit. Enter through the side gate.',
    },
    agent: { id: '00000000-0000-4000-8000-0000000000a1', employee_number: 'FS-10423', first_name: 'Gugu', last_name: 'Dlamini', attributes: { region: 'gauteng' } },
    inspection: { attempt: 1, geofence: { inside: true, method: 'inside_fix', profile: 'residential', relaxed: false, override: false } },
    stats: { active: 3, due_today: 1, awaiting_review: 2, completed_this_month: 14 },
    previous: null,
    ...overrides,
  };
}

// ── Sample-job variants (preview toolbar) ─────────────────────────────────────────────────────────

export type SampleJobVariant = 'standard_home' | 'high_risk_home' | 'shopping_centre' | 'outside_fence';

export const SAMPLE_JOB_VARIANTS: readonly { value: SampleJobVariant; label: string }[] = [
  { value: 'standard_home', label: 'Standard risk · home address' },
  { value: 'high_risk_home', label: 'High risk · home address' },
  { value: 'shopping_centre', label: 'Standard risk · shopping centre' },
  { value: 'outside_fence', label: 'Outside the fence (override)' },
];

/** The context with the sample job switched to a variant (risk tier, location type, geofence result). */
export function applySampleVariant(ctx: PreviewContext, variant: SampleJobVariant): PreviewContext {
  switch (variant) {
    case 'high_risk_home':
      return { ...ctx, job: { ...ctx.job, attributes: { ...ctx.job.attributes, risk_tier: 'high' } } };
    case 'shopping_centre':
      return {
        ...ctx,
        job: {
          ...ctx.job,
          location_type: 'shopping_centre',
          address: { line1: 'Shop 14, Maponya Mall', suburb: 'Klipspruit', city: 'Soweto', province: 'Gauteng', postal_code: '1809' },
        },
        inspection: { ...ctx.inspection, geofence: { ...ctx.inspection.geofence, profile: 'shopping_centre', relaxed: true } },
      };
    case 'outside_fence':
      return { ...ctx, inspection: { ...ctx.inspection, geofence: { ...ctx.inspection.geofence, inside: false, method: 'outside_fix', override: true } } };
    default:
      return ctx;
  }
}

/** A few jobs for list previews (job_list, list_page): the context's job first, then others in various states. */
export function sampleJobList(ctx: PreviewContext): PreviewJob[] {
  const at = (days: number, h: number) => {
    const d = new Date(ctx.job.scheduled.start);
    d.setDate(d.getDate() + days);
    d.setHours(h, 0, 0, 0);
    return d.toISOString();
  };
  const base = ctx.job;
  return [
    base,
    {
      ...base,
      id: '00000000-0000-4000-8000-000000000043',
      reference: 'POS-2026-000043',
      status: 'accepted',
      merchant_name: 'Sizwe Auto Spares',
      address: { line1: '22 Klipspruit Valley Rd', suburb: 'Pimville', city: 'Soweto', province: 'Gauteng', postal_code: '1809' },
      mcc: { code: '5533', description: 'Automotive parts and accessories' },
      scheduled: { start: at(0, 13), end: at(0, 15) },
      onsite_contact: { name: 'Sizwe Ndlovu', phone: '+27 71 555 0198' },
      notes: null,
    },
    {
      ...base,
      id: '00000000-0000-4000-8000-000000000044',
      reference: 'POS-2026-000044',
      status: 'returned',
      merchant_name: 'Lerato Hair Studio',
      address: { line1: '5 Mooki St', suburb: 'Orlando East', city: 'Soweto', province: 'Gauteng', postal_code: '1804' },
      mcc: { code: '7230', description: 'Beauty and barber shops' },
      scheduled: { start: at(1, 9), end: at(1, 11) },
      onsite_contact: { name: 'Lerato Molefe', phone: '+27 83 555 0120' },
      notes: 'Returned: retake the shopfront photo.',
    },
    {
      ...base,
      id: '00000000-0000-4000-8000-000000000045',
      reference: 'POS-2026-000045',
      status: 'approved',
      merchant_name: 'Kasi Kota Corner',
      address: { line1: '901 Machaba Dr', suburb: 'Dobsonville', city: 'Soweto', province: 'Gauteng', postal_code: '1863' },
      mcc: { code: '5814', description: 'Fast food restaurants' },
      scheduled: { start: at(-2, 10), end: at(-2, 12) },
      onsite_contact: { name: 'Thabo Sithole', phone: '+27 72 555 0177' },
      notes: null,
    },
  ];
}

/** Sample receipt (inspection.receipt) for evidence_status and receipt screens. */
export function sampleReceipt(ctx: PreviewContext): Record<string, unknown> {
  const t = new Date(ctx.job.scheduled.start);
  t.setMinutes(t.getMinutes() + 72);
  return { state: 'received', received_at: t.toISOString(), photos_expected: 5, photos_verified: 5, photos_pending: 0, pending_items: 0 };
}
