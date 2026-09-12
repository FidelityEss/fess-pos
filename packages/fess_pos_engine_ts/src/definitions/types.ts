/**
 * TypeScript shapes of definitions (docs/04 §3). Deliberately broad where the catalogue decides the
 * details (component `props`), so engine code reads props through the catalogue, never by name.
 */
import type { JsonObject, JsonPrimitive, JsonValue } from "../json.ts";
import type { DefinitionKind } from "./catalogue.ts";

/** A literal or an operator object. */
export type Expression = JsonValue;
/** An operator object (`{ "op": args }`). */
export type Operation = JsonObject;
/** Literal of T, or an expression producing T (the "R" in docs/11). */
export type Ruleable<T> = T | Operation;

export interface OptionDef {
  value: string;
  label: string;
  help_text?: string;
  meta?: Record<string, JsonPrimitive>;
}

export type OptionsSource = { type: "lookup_list"; key: string } | { type: "reason_codes"; category: string };

export interface ValidateRule {
  rule: Ruleable<boolean>;
  message: string;
  code?: string;
}

export interface RiskIndicator {
  when: Ruleable<boolean>;
  level: "info" | "elevated" | "high";
  label?: string;
}

export interface AssetRef {
  sha256: string;
  alt?: string;
}

export interface FallbackDef {
  type: string;
  display?: string;
  props?: JsonObject;
}

export interface FieldDef {
  key: string;
  type: string;
  id?: string;
  label?: Ruleable<string>;
  help_text?: string;
  display?: string;
  required?: Ruleable<boolean>;
  visible?: Ruleable<boolean>;
  read_only?: Ruleable<boolean>;
  value?: Expression;
  default?: Expression;
  validate?: ValidateRule[];
  risk_indicator?: RiskIndicator;
  reviewer_note?: string;
  export?: { include?: boolean; column_label?: string };
  pdf?: { include?: boolean; layout?: "full" | "compact" | "table" };
  fallback?: FallbackDef;
  props?: JsonObject;
  options?: OptionDef[];
  options_source?: OptionsSource;
  options_filter?: Ruleable<boolean>;
  // display components (top-level props)
  text?: string;
  tone?: string;
  asset?: AssetRef;
  caption?: string;
  // containers
  fields?: FieldDef[];
}

export interface SectionDef {
  key: string;
  id?: string;
  title?: Ruleable<string>;
  description?: string;
  visible?: Ruleable<boolean>;
  page_break?: boolean;
  fields: FieldDef[];
}

export interface Requires {
  spec: string;
  components?: Record<string, number>;
  step_types?: Record<string, number>;
  view_components?: Record<string, number>;
  page_types?: Record<string, number>;
}

export interface DefinitionHeader {
  spec_version: string;
  kind: DefinitionKind;
  family: string;
  version: number;
  scope?: { bank_id: string | null } | null;
  id?: string;
  title?: string;
  description?: string;
  locale?: string;
  requires?: Requires;
}

export interface FormDefinition extends DefinitionHeader {
  kind: "form";
  declaration_key?: string;
  sections: SectionDef[];
}

export type Target = { page: string } | { flow: string };

export interface StepDef {
  id?: string;
  type: string;
  label?: string;
  visible?: Ruleable<boolean>;
  next?: string | Operation;
  view?: string;
  acknowledgement_text?: string;
  messages?: Record<string, string>;
  checkin_prompt?: "profile" | "always";
  override_form?: string;
  form?: string;
  sections?: string[];
  paging?: "section_per_page" | "single_page";
  show_risk_indicators?: boolean;
  allow_jump_back?: boolean;
  declaration_key?: string;
  confirm_text?: string;
}

export interface FlowDefinition extends DefinitionHeader {
  kind: "flow";
  form_family?: string;
  action?: string;
  steps: StepDef[];
}

export interface JobSchemaDefinition extends DefinitionHeader {
  kind: "job_schema";
  attributes: FieldDef[];
}

export interface ViewItemDef {
  type: string;
  id?: string;
  visible?: Ruleable<boolean>;
  bind?: string;
  text?: string;
  label?: string;
  format?: string;
  height?: number;
  actions?: string[];
  tone?: string;
  asset?: AssetRef;
  caption?: string;
  tiles?: ViewItemDef[];
  source?: string;
  collection?: string;
  filter?: Ruleable<boolean>;
  stat?: string;
  on_tap?: Target;
  title?: string;
  sort?: string;
  sort_direction?: "asc" | "desc";
  item_view?: string;
  limit?: number;
  empty_content?: string;
  target?: Target;
  style?: string;
  show_photo?: boolean;
  show_qr?: boolean;
  show_status?: boolean;
}

export interface ViewDefinition extends DefinitionHeader {
  kind: "view";
  items: ViewItemDef[];
}

export interface ContentDefinition extends DefinitionHeader {
  kind: "content";
  locale: string;
  strings: Record<string, string>;
}

export interface PageDef {
  type: string;
  title?: string;
  view?: string;
  actions?: { label: string; target: Target }[];
  source?: string;
  filter?: Ruleable<boolean>;
  sort?: string;
  sort_direction?: "asc" | "desc";
  group_by?: string;
  item_view?: string;
  on_tap?: Target;
  empty_content?: string;
  form?: string;
  sections?: string[];
  action?: string;
  subject?: "job" | "agent" | "none";
  outcomes?: string;
  flow?: string;
  outcome?: "success" | "saved" | "failure";
  message?: string;
  icon?: string;
  buttons?: { label: string; action: string; target?: Target }[];
  auto_return_s?: number;
}

export interface AppDefinition extends DefinitionHeader {
  kind: "app";
  home: string;
  navigation?: { style: "bottom_tabs" | "drawer" | "none"; items: { label: string; icon?: string; page: string }[] };
  pages: Record<string, PageDef>;
  outcome_sets?: Record<string, { success: string; saved: string; failure: string }>;
}

export type Definition =
  | FormDefinition
  | FlowDefinition
  | JobSchemaDefinition
  | ViewDefinition
  | ContentDefinition
  | AppDefinition;
