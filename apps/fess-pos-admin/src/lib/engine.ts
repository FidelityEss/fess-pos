// The admin panel's window onto the shared TS engine (@fess-pos/engine, packages/fess_pos_engine_ts): the same config
// contract and definition parser / resolver / validator the POS API and the phone module use. Import engine features
// through this file so the surface the panel depends on stays visible in one place.
export {
  REMOTE_CONFIG_KEYS,
  REMOTE_CONFIG_DEFAULTS,
  DEFAULT_GEOFENCE_PROFILES,
  PROFILE_BOUNDS,
  RemoteConfigLayerSchema,
  resolveRemoteConfig,
  integrityRelevantChanges,
  parseDefinitionOfKind,
  resolveForm,
  compileForm,
  validateAnswers,
  contextFromSnapshot,
  analyseDefinition,
  evaluate,
} from '@fess-pos/engine';
export type { ConfigKeySpec, ConfigLeafType, JsonObject as EngineJsonObject, JsonValue as EngineJsonValue } from '@fess-pos/engine';

// Definitions studio (T3-09 / T3-11): the component, step, view-component and page-type catalogues the structured editors
// are generated from, plus template helpers.
export {
  COMPONENTS,
  STEPS,
  VIEW_COMPONENTS,
  PAGE_TYPES,
  FLOW_ACTIONS,
  FORM_PAGE_ACTIONS,
  OUTCOMES,
  OUTCOME_BUTTON_ACTIONS,
  NAV_STYLES,
  LIST_SOURCES,
  KEY_RE,
  templatePaths,
  isValidTemplate,
} from '@fess-pos/engine';
export type { ComponentSpec, ComponentCategory, PropKind, PropSpec, StepSpec, ViewComponentSpec, PageTypeSpec } from '@fess-pos/engine';

// Phone preview renderer (T3-23): per-element schemas (render the valid parts of a draft), templates and the definition /
// resolver shapes the renderer reads.
export {
  componentSpec,
  renderTemplate,
  FieldSchema,
  SectionSchema,
  StepSchema,
  ViewItemSchema,
  PageSchema,
  AttributeSchema,
} from '@fess-pos/engine';
export type {
  FormDefinition,
  FlowDefinition,
  ViewDefinition,
  AppDefinition,
  ContentDefinition,
  JobSchemaDefinition,
  FieldDef,
  SectionDef,
  StepDef,
  ViewItemDef,
  PageDef,
  OptionDef,
  ResolvedForm,
  ResolvedField,
  ResolveContext,
  ResolveLists,
  RawAnswers,
  AnswerEntry,
  ValidationError as EngineValidationError,
  DefinitionIssue,
} from '@fess-pos/engine';
