/**
 * Component, flow-step, view-component, page-type and action catalogues for spec 1.0 (docs/11).
 * Pure data: the Zod mirrors are built from it, and a test checks it against
 * `schema/definitions/*.schema.json` so the language-agnostic contract and the TS engine agree.
 *
 * Placement convention (documented in schema/README.md):
 * - input, computed and structural components carry type-specific props inside `props`;
 *   choice components also carry `options` / `options_source` / `options_filter` at top level;
 * - display components (`info`, `callout`, `divider`, `image`) carry their few props at top level.
 */
import type { RuleType } from "../rules/spec.ts";

export const SPEC_VERSION = "1.0";
export const SUPPORTED_SPEC_MAJOR = 1;
export const SUPPORTED_SPEC_MINOR = 0;

export type PropKind =
  | { readonly t: "string"; readonly pattern?: string; readonly max?: number }
  | { readonly t: "template" }
  | { readonly t: "bool" }
  | { readonly t: "int"; readonly min?: number; readonly max?: number }
  | { readonly t: "number"; readonly min?: number; readonly max?: number; readonly positive?: boolean }
  | { readonly t: "enum"; readonly values: readonly string[] }
  | { readonly t: "enum_list"; readonly values: readonly string[] }
  | { readonly t: "string_list" }
  | { readonly t: "key" }
  | { readonly t: "key_list" }
  | { readonly t: "path" }
  | { readonly t: "regex" }
  | { readonly t: "date" }
  | { readonly t: "time" }
  | { readonly t: "datetime" }
  | { readonly t: "asset" }
  | { readonly t: "target" }
  | {
      readonly t: "def";
      readonly def: "guidance" | "tri_labels" | "matrix_rows" | "matrix_columns" | "required_rows" | "stat_tiles" | "buttons" | "page_actions" | "messages";
    };

export interface PropSpec {
  readonly kind: PropKind;
  /** R in docs/11: literal or expression. */
  readonly ruleable?: boolean;
  readonly required?: boolean;
}

export type ComponentCategory = "text" | "choice" | "date" | "location" | "evidence" | "legal" | "display" | "computed" | "structural";

export interface ComponentSpec {
  readonly type: string;
  readonly version: number;
  readonly wave: 1 | 2;
  readonly category: ComponentCategory;
  /** input: common input props + `props`; display: top-level props only; group: container. */
  readonly shape: "input" | "display" | "group";
  /** Value type seen by rules (`answers.<key>`); "none" = no value. */
  readonly valueType: RuleType | "none";
  readonly displays: readonly string[];
  readonly props: Readonly<Record<string, PropSpec>>;
  /** Top-level options support. */
  readonly options?: "static_or_source" | "filter_only";
  /** Container of child fields (`fields`). */
  readonly hasFields?: boolean;
  /** `value` (computed rule) is required. */
  readonly requiresValue?: boolean;
  /** Allowed as a `job_schema` attribute (non-evidence input components). */
  readonly jobSchema: boolean;
}

const p = (kind: PropKind, extra: Omit<PropSpec, "kind"> = {}): PropSpec => ({ kind, ...extra });
const R = (kind: PropKind, extra: Omit<PropSpec, "kind" | "ruleable"> = {}): PropSpec => ({ kind, ruleable: true, ...extra });

const TEXT_PROPS = {
  min_length: R({ t: "int", min: 0 }),
  max_length: R({ t: "int", min: 1 }),
  pattern: p({ t: "regex" }),
  mask: p({ t: "string", max: 100 }),
  placeholder: p({ t: "template" }),
  keyboard: p({ t: "enum", values: ["text", "number", "phone", "email", "url"] }),
  capitalise: p({ t: "enum", values: ["none", "words", "sentences", "characters"] }),
} as const;

const OTHER_PROPS = {
  allow_other: p({ t: "bool" }),
  other_value: p({ t: "string", max: 100 }),
  other_label: p({ t: "template" }),
} as const;

const c = (s: ComponentSpec): ComponentSpec => s;

export const COMPONENTS: Readonly<Record<string, ComponentSpec>> = {
  // 3.1 Text & numbers
  text: c({ type: "text", version: 1, wave: 1, category: "text", shape: "input", valueType: "string", displays: ["single_line"], props: TEXT_PROPS, jobSchema: true }),
  textarea: c({
    type: "textarea", version: 1, wave: 1, category: "text", shape: "input", valueType: "string", displays: ["multi_line"],
    props: { ...TEXT_PROPS, rows: p({ t: "int", min: 1, max: 20 }) }, jobSchema: true,
  }),
  number: c({
    type: "number", version: 1, wave: 1, category: "text", shape: "input", valueType: "number", displays: ["plain", "stepper"],
    props: {
      min: R({ t: "number" }), max: R({ t: "number" }), integer: p({ t: "bool" }), decimals: p({ t: "int", min: 0, max: 10 }),
      unit: p({ t: "string", max: 20 }), step: p({ t: "number", positive: true }), placeholder: p({ t: "template" }),
    },
    jobSchema: true,
  }),
  percentage: c({
    type: "percentage", version: 1, wave: 1, category: "text", shape: "input", valueType: "number", displays: ["plain", "slider"],
    props: { min: R({ t: "number", min: 0, max: 100 }), max: R({ t: "number", min: 0, max: 100 }), decimals: p({ t: "int", min: 0, max: 10 }) },
    jobSchema: true,
  }),
  phone: c({
    type: "phone", version: 1, wave: 1, category: "text", shape: "input", valueType: "string", displays: [],
    props: { default_region: p({ t: "string", pattern: "^[A-Z]{2}$" }), allow_landline: p({ t: "bool" }) }, jobSchema: true,
  }),
  currency: c({
    type: "currency", version: 1, wave: 2, category: "text", shape: "input", valueType: "object", displays: [],
    props: { min: R({ t: "int" }), max: R({ t: "int" }), currency: p({ t: "string", pattern: "^[A-Z]{3}$" }) }, jobSchema: true,
  }),
  slider: c({
    type: "slider", version: 1, wave: 2, category: "text", shape: "input", valueType: "number", displays: [],
    props: {
      min: p({ t: "number" }, { required: true }), max: p({ t: "number" }, { required: true }), step: p({ t: "number", positive: true }),
      min_label: p({ t: "template" }), max_label: p({ t: "template" }),
    },
    jobSchema: true,
  }),
  rating: c({
    type: "rating", version: 1, wave: 2, category: "text", shape: "input", valueType: "number", displays: ["stars", "numbered", "likert"],
    props: { scale: p({ t: "int", min: 3, max: 10 }), labels: p({ t: "string_list" }) }, jobSchema: true,
  }),
  email: c({ type: "email", version: 1, wave: 2, category: "text", shape: "input", valueType: "string", displays: [], props: { placeholder: p({ t: "template" }) }, jobSchema: true }),
  id_number: c({
    type: "id_number", version: 1, wave: 2, category: "text", shape: "input", valueType: "string", displays: [],
    props: { scheme: p({ t: "enum", values: ["za_id", "passport", "custom"] }, { required: true }), pattern: p({ t: "regex" }) }, jobSchema: true,
  }),
  registration_number: c({
    type: "registration_number", version: 1, wave: 2, category: "text", shape: "input", valueType: "string", displays: [],
    props: { scheme: p({ t: "enum", values: ["cipc", "vat_za", "custom"] }, { required: true }), pattern: p({ t: "regex" }) }, jobSchema: true,
  }),
  // 3.2 Choice
  boolean: c({
    type: "boolean", version: 1, wave: 1, category: "choice", shape: "input", valueType: "boolean", displays: ["yes_no_radio", "toggle", "checkbox"],
    props: { true_label: p({ t: "template" }), false_label: p({ t: "template" }) }, jobSchema: true,
  }),
  tri_state: c({
    type: "tri_state", version: 1, wave: 1, category: "choice", shape: "input", valueType: "string", displays: ["segmented", "radio"],
    props: { labels: p({ t: "def", def: "tri_labels" }) }, jobSchema: true,
  }),
  single_select: c({
    type: "single_select", version: 1, wave: 1, category: "choice", shape: "input", valueType: "string",
    displays: ["radio", "dropdown", "chips", "segmented", "searchable_list"], props: OTHER_PROPS, options: "static_or_source", jobSchema: true,
  }),
  multi_select: c({
    type: "multi_select", version: 1, wave: 1, category: "choice", shape: "input", valueType: "array", displays: ["checkboxes", "chips"],
    props: { min_select: R({ t: "int", min: 0 }), max_select: R({ t: "int", min: 1 }), ...OTHER_PROPS, exclusive_options: p({ t: "string_list" }) },
    options: "static_or_source", jobSchema: true,
  }),
  lookup: c({
    type: "lookup", version: 1, wave: 2, category: "choice", shape: "input", valueType: "string", displays: ["searchable_sheet"],
    props: { list: p({ t: "key" }, { required: true }), search: p({ t: "bool" }) }, options: "filter_only", jobSchema: true,
  }),
  // 3.3 Date & time
  date: c({
    type: "date", version: 1, wave: 1, category: "date", shape: "input", valueType: "string", displays: [],
    props: { min: R({ t: "date" }), max: R({ t: "date" }), allow_unknown: p({ t: "bool" }) }, jobSchema: true,
  }),
  time: c({ type: "time", version: 1, wave: 1, category: "date", shape: "input", valueType: "string", displays: [], props: { min: p({ t: "time" }), max: p({ t: "time" }) }, jobSchema: true }),
  duration: c({
    type: "duration", version: 1, wave: 1, category: "date", shape: "input", valueType: "object", displays: [],
    props: { units: p({ t: "enum_list", values: ["days", "months", "years"] }) }, jobSchema: true,
  }),
  business_hours: c({
    type: "business_hours", version: 1, wave: 1, category: "date", shape: "input", valueType: "object", displays: [],
    props: { groups: p({ t: "enum_list", values: ["weekdays", "saturday", "sunday", "public_holidays"] }), allow_24h: p({ t: "bool" }) }, jobSchema: true,
  }),
  datetime: c({ type: "datetime", version: 1, wave: 2, category: "date", shape: "input", valueType: "string", displays: [], props: { min: R({ t: "datetime" }), max: R({ t: "datetime" }) }, jobSchema: true }),
  // 3.4 Location
  address: c({
    type: "address", version: 1, wave: 1, category: "location", shape: "input", valueType: "object", displays: [],
    props: {
      map_pin: p({ t: "enum", values: ["none", "optional", "required"] }), geocode: p({ t: "enum", values: ["off", "when_online"] }),
      provinces: p({ t: "string_list" }),
    },
    jobSchema: true,
  }),
  location_pin: c({
    type: "location_pin", version: 1, wave: 1, category: "location", shape: "input", valueType: "object", displays: [],
    props: { initial: p({ t: "enum", values: ["job", "current"] }), max_distance_from_job_m: R({ t: "number", min: 0 }) }, jobSchema: true,
  }),
  current_location: c({
    type: "current_location", version: 1, wave: 2, category: "location", shape: "input", valueType: "object", displays: [],
    props: { max_accuracy_m: R({ t: "number", min: 0 }), sample_seconds: p({ t: "int", min: 1, max: 300 }) }, jobSchema: false,
  }),
  // 3.5 Evidence
  photo: c({
    type: "photo", version: 1, wave: 1, category: "evidence", shape: "input", valueType: "array", displays: ["grid", "guided_sequence"],
    props: {
      min_count: R({ t: "int", min: 0 }), max_count: R({ t: "int", min: 1 }), category: p({ t: "key" }, { required: true }),
      require_gps: p({ t: "bool" }), guidance: p({ t: "def", def: "guidance" }), caption: p({ t: "enum", values: ["none", "optional", "required"] }),
      retake: p({ t: "enum", values: ["allowed", "confirm", "disallowed"] }),
    },
    jobSchema: false,
  }),
  signature: c({
    type: "signature", version: 1, wave: 1, category: "evidence", shape: "input", valueType: "string", displays: [],
    props: { signer_name_field: p({ t: "key" }), signer_designation_field: p({ t: "key" }), min_stroke_length: p({ t: "int", min: 0 }) }, jobSchema: false,
  }),
  // 3.6 Legal
  declaration: c({ type: "declaration", version: 1, wave: 1, category: "legal", shape: "input", valueType: "object", displays: [], props: { declaration_key: p({ t: "key" }, { required: true }) }, jobSchema: false }),
  acknowledgement: c({ type: "acknowledgement", version: 1, wave: 1, category: "legal", shape: "input", valueType: "boolean", displays: [], props: { text: p({ t: "template" }, { required: true }) }, jobSchema: false }),
  consent: c({
    type: "consent", version: 1, wave: 2, category: "legal", shape: "input", valueType: "object", displays: [],
    props: { declaration_key: p({ t: "key" }, { required: true }), by_name_field: p({ t: "key" }) }, jobSchema: false,
  }),
  // 4. Display & computed
  info: c({ type: "info", version: 1, wave: 1, category: "display", shape: "display", valueType: "none", displays: [], props: { text: p({ t: "template" }, { required: true }) }, jobSchema: false }),
  callout: c({
    type: "callout", version: 1, wave: 1, category: "display", shape: "display", valueType: "none", displays: [],
    props: { tone: p({ t: "enum", values: ["info", "warning", "danger"] }, { required: true }), text: p({ t: "template" }, { required: true }) }, jobSchema: false,
  }),
  divider: c({ type: "divider", version: 1, wave: 1, category: "display", shape: "display", valueType: "none", displays: [], props: {}, jobSchema: false }),
  image: c({ type: "image", version: 1, wave: 2, category: "display", shape: "display", valueType: "none", displays: [], props: { asset: p({ t: "asset" }, { required: true }), caption: p({ t: "template" }) }, jobSchema: false }),
  prefilled: c({
    type: "prefilled", version: 1, wave: 1, category: "computed", shape: "input", valueType: "any", displays: [],
    props: {
      source: p({ t: "string", pattern: "^(job|agent)(\\.[a-z0-9_]+)+$" }, { required: true }),
      allow_flag_differs: p({ t: "bool" }), differs_note: p({ t: "template" }),
    },
    jobSchema: false,
  }),
  computed: c({
    type: "computed", version: 1, wave: 2, category: "computed", shape: "input", valueType: "any", displays: [],
    props: { format: p({ t: "enum", values: ["text", "number", "percentage", "currency", "date"] }), decimals: p({ t: "int", min: 0, max: 10 }), hidden: p({ t: "bool" }) },
    requiresValue: true, jobSchema: false,
  }),
  // 5. Structural
  group: c({ type: "group", version: 1, wave: 1, category: "structural", shape: "group", valueType: "none", displays: [], props: { layout: p({ t: "enum", values: ["stack", "two_column"] }) }, hasFields: true, jobSchema: false }),
  repeatable_group: c({
    type: "repeatable_group", version: 1, wave: 2, category: "structural", shape: "input", valueType: "array", displays: [],
    props: { min_items: R({ t: "int", min: 0 }), max_items: R({ t: "int", min: 1 }), item_label: p({ t: "template" }), add_label: p({ t: "template" }) },
    hasFields: true, jobSchema: false,
  }),
  matrix: c({
    type: "matrix", version: 1, wave: 2, category: "structural", shape: "input", valueType: "object", displays: [],
    props: {
      rows: p({ t: "def", def: "matrix_rows" }, { required: true }), columns: p({ t: "def", def: "matrix_columns" }, { required: true }),
      cell_type: p({ t: "enum", values: ["single", "multi", "text"] }, { required: true }), required_rows: p({ t: "def", def: "required_rows" }),
    },
    jobSchema: false,
  }),
};

export const COMPONENT_TYPES: readonly string[] = Object.keys(COMPONENTS);

/** Common props of every input component (docs/11 §2) plus the engine's `id`. */
export const INPUT_COMMON_PROPS = [
  "key", "id", "type", "label", "help_text", "display", "required", "visible", "read_only", "value", "default",
  "validate", "risk_indicator", "reviewer_note", "export", "pdf", "fallback", "props",
] as const;
export const DISPLAY_COMMON_PROPS = ["key", "id", "type", "visible", "pdf"] as const;
export const GROUP_COMMON_PROPS = ["key", "id", "type", "label", "help_text", "visible", "pdf", "props", "fields"] as const;

export function isComponentType(t: string): boolean {
  return Object.prototype.hasOwnProperty.call(COMPONENTS, t);
}

export function componentSpec(t: string): ComponentSpec | undefined {
  return isComponentType(t) ? COMPONENTS[t] : undefined;
}

/** True when the component carries an answer (appears in `answers`). */
export function hasValue(spec: ComponentSpec): boolean {
  return spec.valueType !== "none";
}

// ---------------------------------------------------------------- flow steps (docs/11 §6)

export interface StepSpec {
  readonly type: string;
  readonly version: number;
  /** Integrity steps cannot be removed or made optional (docs/07 §6). */
  readonly integrity: boolean;
  /** May carry `visible` (optional steps only). */
  readonly removable: boolean;
  readonly props: Readonly<Record<string, PropSpec>>;
}

export const STEPS: Readonly<Record<string, StepSpec>> = {
  job_briefing: { type: "job_briefing", version: 1, integrity: false, removable: true, props: { view: p({ t: "key" }, { required: true }), acknowledgement_text: p({ t: "template" }) } },
  location_check: {
    type: "location_check", version: 1, integrity: true, removable: false,
    props: { messages: p({ t: "def", def: "messages" }), checkin_prompt: p({ t: "enum", values: ["profile", "always"] }), override_form: p({ t: "key" }) },
  },
  form: {
    type: "form", version: 1, integrity: false, removable: false,
    props: { form: p({ t: "key" }), sections: p({ t: "key_list" }, { required: true }), paging: p({ t: "enum", values: ["section_per_page", "single_page"] }) },
  },
  summary_review: { type: "summary_review", version: 1, integrity: false, removable: true, props: { show_risk_indicators: p({ t: "bool" }), allow_jump_back: p({ t: "bool" }) } },
  declaration: { type: "declaration", version: 1, integrity: true, removable: false, props: { declaration_key: p({ t: "key" }) } },
  submit: { type: "submit", version: 1, integrity: true, removable: false, props: { confirm_text: p({ t: "template" }) } },
  receipt: { type: "receipt", version: 1, integrity: false, removable: true, props: { view: p({ t: "key" }, { required: true }) } },
};
export const STEP_TYPES: readonly string[] = Object.keys(STEPS);
export const STEP_COMMON_PROPS = ["id", "type", "label", "visible", "next"] as const;

// ---------------------------------------------------------------- actions (docs/11 §7.3)

export interface ActionSpec {
  readonly name: string;
  readonly envelope: string | null;
  /** Actions a `form_page` may submit to. */
  readonly formPage: boolean;
  /** Actions a `flow` may submit to. */
  readonly flow: boolean;
  readonly status: "active" | "pending_decision" | "deferred";
}

export const ACTIONS: Readonly<Record<string, ActionSpec>> = {
  "job.accept": { name: "job.accept", envelope: "job_event", formPage: true, flow: true, status: "active" },
  "job.reject": { name: "job.reject", envelope: "job_event", formPage: true, flow: true, status: "active" },
  "job.unable": { name: "job.unable", envelope: "job_event", formPage: true, flow: true, status: "active" },
  "inspection.start": { name: "inspection.start", envelope: "inspection_started", formPage: false, flow: false, status: "active" },
  "inspection.submit": { name: "inspection.submit", envelope: "submission", formPage: false, flow: true, status: "active" },
  "record.submit": { name: "record.submit", envelope: "form_submission", formPage: true, flow: true, status: "active" },
  "lead.create": { name: "lead.create", envelope: "lead_created", formPage: true, flow: true, status: "pending_decision" },
  navigate: { name: "navigate", envelope: null, formPage: false, flow: false, status: "active" },
  "panic.raise": { name: "panic.raise", envelope: null, formPage: false, flow: false, status: "deferred" },
};
export const ACTION_NAMES: readonly string[] = Object.keys(ACTIONS);
export const FORM_PAGE_ACTIONS: readonly string[] = ACTION_NAMES.filter((a) => (ACTIONS[a] as ActionSpec).formPage);
export const FLOW_ACTIONS: readonly string[] = ACTION_NAMES.filter((a) => (ACTIONS[a] as ActionSpec).flow);

// ---------------------------------------------------------------- view components (docs/11 §7.2)

export interface ViewComponentSpec {
  readonly type: string;
  readonly version: number;
  readonly group: "display" | "home" | "card";
  readonly props: Readonly<Record<string, PropSpec>>;
}

const v = (type: string, group: ViewComponentSpec["group"], props: Record<string, PropSpec>): ViewComponentSpec => ({ type, version: 1, group, props });
const TONES = ["neutral", "info", "success", "warning", "danger"] as const;

export const VIEW_COMPONENTS: Readonly<Record<string, ViewComponentSpec>> = {
  title: v("title", "display", { bind: p({ t: "path" }), text: p({ t: "template" }) }),
  field_value: v("field_value", "display", { label: p({ t: "template" }), bind: p({ t: "path" }, { required: true }), format: p({ t: "enum", values: ["text", "date", "datetime", "number", "currency"] }) }),
  address_block: v("address_block", "display", { label: p({ t: "template" }), bind: p({ t: "path" }, { required: true }) }),
  map_preview: v("map_preview", "display", { bind: p({ t: "path" }, { required: true }), height: p({ t: "int", min: 80, max: 600 }) }),
  contact: v("contact", "display", { label: p({ t: "template" }), bind: p({ t: "path" }, { required: true }), actions: p({ t: "enum_list", values: ["call", "sms", "email"] }) }),
  schedule_window: v("schedule_window", "display", { label: p({ t: "template" }), bind: p({ t: "path" }, { required: true }) }),
  status_chip: v("status_chip", "display", { bind: p({ t: "path" }, { required: true }) }),
  badge: v("badge", "display", { text: p({ t: "template" }, { required: true }), tone: p({ t: "enum", values: TONES }) }),
  markdown: v("markdown", "display", { text: p({ t: "template" }, { required: true }) }),
  image: v("image", "display", { asset: p({ t: "asset" }, { required: true }), caption: p({ t: "template" }) }),
  divider: v("divider", "display", {}),
  evidence_status: v("evidence_status", "display", { bind: p({ t: "path" }, { required: true }) }),
  greeting: v("greeting", "home", { text: p({ t: "template" }, { required: true }) }),
  section_title: v("section_title", "home", { text: p({ t: "template" }, { required: true }) }),
  stat_row: v("stat_row", "home", { tiles: p({ t: "def", def: "stat_tiles" }, { required: true }) }),
  stat_tile: v("stat_tile", "home", {
    label: p({ t: "template" }, { required: true }), source: p({ t: "enum", values: ["local", "server"] }, { required: true }),
    collection: p({ t: "enum", values: ["jobs", "inspections", "form_submissions"] }), filter: R({ t: "bool" }), stat: p({ t: "path" }), on_tap: p({ t: "target" }),
  }),
  job_list: v("job_list", "home", {
    title: p({ t: "template" }), filter: R({ t: "bool" }), sort: p({ t: "path" }), sort_direction: p({ t: "enum", values: ["asc", "desc"] }),
    item_view: p({ t: "key" }, { required: true }), limit: p({ t: "int", min: 1, max: 50 }), on_tap: p({ t: "target" }), empty_content: p({ t: "string", max: 200 }),
  }),
  agent_card_summary: v("agent_card_summary", "home", { on_tap: p({ t: "target" }) }),
  action_button: v("action_button", "home", {
    label: p({ t: "template" }, { required: true }), target: p({ t: "target" }, { required: true }), style: p({ t: "enum", values: ["primary", "secondary"] }),
  }),
  sync_status: v("sync_status", "home", {}),
  announcement: v("announcement", "home", { text: p({ t: "template" }, { required: true }), tone: p({ t: "enum", values: TONES }) }),
  agent_card: v("agent_card", "card", { show_photo: p({ t: "bool" }), show_qr: p({ t: "bool" }), show_status: p({ t: "bool" }) }),
  job_card: v("job_card", "card", { show_photo: p({ t: "bool" }), show_qr: p({ t: "bool" }), show_status: p({ t: "bool" }) }),
};
export const VIEW_COMPONENT_TYPES: readonly string[] = Object.keys(VIEW_COMPONENTS);
export const VIEW_ITEM_COMMON_PROPS = ["type", "id", "visible"] as const;

// ---------------------------------------------------------------- page types (docs/11 §7.1)

export interface PageTypeSpec {
  readonly type: string;
  readonly version: number;
  readonly props: Readonly<Record<string, PropSpec>>;
}

export const OUTCOMES = ["success", "saved", "failure"] as const;
export const LIST_SOURCES = ["jobs", "inspections", "form_submissions"] as const;

export const PAGE_TYPES: Readonly<Record<string, PageTypeSpec>> = {
  view_page: { type: "view_page", version: 1, props: { view: p({ t: "key" }, { required: true }), title: p({ t: "template" }), actions: p({ t: "def", def: "page_actions" }) } },
  list_page: {
    type: "list_page", version: 1,
    props: {
      title: p({ t: "template" }), source: p({ t: "enum", values: LIST_SOURCES }, { required: true }), filter: R({ t: "bool" }),
      sort: p({ t: "path" }), sort_direction: p({ t: "enum", values: ["asc", "desc"] }), group_by: p({ t: "path" }),
      item_view: p({ t: "key" }, { required: true }), on_tap: p({ t: "target" }), empty_content: p({ t: "string", max: 200 }),
    },
  },
  form_page: {
    type: "form_page", version: 1,
    props: {
      title: p({ t: "template" }), form: p({ t: "key" }, { required: true }), sections: p({ t: "key_list" }),
      action: p({ t: "enum", values: FORM_PAGE_ACTIONS }, { required: true }), subject: p({ t: "enum", values: ["job", "agent", "none"] }),
      outcomes: p({ t: "key" }, { required: true }),
    },
  },
  flow: { type: "flow", version: 1, props: { title: p({ t: "template" }), flow: p({ t: "key" }, { required: true }), outcomes: p({ t: "key" }, { required: true }) } },
  outcome_page: {
    type: "outcome_page", version: 1,
    props: {
      outcome: p({ t: "enum", values: OUTCOMES }, { required: true }), title: p({ t: "template" }), message: p({ t: "template" }),
      icon: p({ t: "string", max: 50 }), buttons: p({ t: "def", def: "buttons" }), auto_return_s: p({ t: "int", min: 0, max: 60 }),
    },
  },
};
export const PAGE_TYPE_NAMES: readonly string[] = Object.keys(PAGE_TYPES);

export const OUTCOME_BUTTON_ACTIONS = ["home", "receipt", "retry", "start_flow", "page", "back"] as const;
export const NAV_STYLES = ["bottom_tabs", "drawer", "none"] as const;
export const DEFINITION_KINDS = ["form", "flow", "job_schema", "view", "content", "app"] as const;
export type DefinitionKind = (typeof DEFINITION_KINDS)[number];

/** Roots a rule `var` path may start with (docs/04 §4.2), plus scoped roots. */
export const RULE_ROOTS = ["answers", "item", "index", "job", "agent", "inspection", "stats", "previous", "config", "derived", "option", "current", "current_index", "record"] as const;
