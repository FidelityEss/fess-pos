// The admin's side of the module preview (T3-12, D-90, D-101): the module's own web build, served by this admin at
// /module-preview/ (scripts/build-module-preview.mjs), runs in an iframe and draws the draft it is sent over postMessage.
// Same origin as the admin, so the module's origin check (its own origin, fail closed) lets exactly this admin talk to it.
//
// Messages (docs/04 §10, D-90 (2)):
//   module → admin  fess_pos.preview.ready     {version, module_version, capabilities}
//   admin → module  fess_pos.preview.render    {version, request: {kind, definition, bundle, context, theme?}}
//   module → admin  fess_pos.preview.rendered  {version, ok, problems}
import { isPlainObject } from '@/lib/utils';
import type { PreviewBundle, PreviewKind } from './definition-preview';
import type { PhoneTheme } from './phone-frame';
import type { PreviewContext } from './sample-context';

export const MODULE_PREVIEW_PATH = '/module-preview/';
export const PREVIEW_READY = 'fess_pos.preview.ready';
export const PREVIEW_RENDER = 'fess_pos.preview.render';
export const PREVIEW_RENDERED = 'fess_pos.preview.rendered';

/** The phone the app draws on, in CSS pixels: a real phone's screen (390 × 844), so it lays out as it would there. */
export const MODULE_PHONE = { width: 390, height: 844 } as const;

/** What the module draws: the props of DefinitionPreview, in the module's own shape (PreviewRequest.fromJson). */
export interface ModulePreviewRequest {
  kind: PreviewKind;
  definition: Record<string, unknown>;
  bundle: Record<string, unknown>;
  context: Record<string, unknown>;
  theme?: { primary_color: string | null; font_family: string | null };
}

/**
 * The request for a preview, or null when there is nothing to draw. The bundle's `jobSchema` becomes the module's
 * `job_schemas.job_attributes` (the job information the app reads); everything else keeps its name.
 */
export function toModuleRequest(
  kind: PreviewKind,
  definition: unknown,
  bundle: PreviewBundle | undefined,
  context: PreviewContext,
  theme?: PhoneTheme,
): ModulePreviewRequest | null {
  if (!isPlainObject(definition)) return null;
  const b = bundle ?? {};
  const out: Record<string, unknown> = {};
  if (b.forms) out.forms = b.forms;
  if (b.flows) out.flows = b.flows;
  if (b.views) out.views = b.views;
  if (isPlainObject(b.jobSchema)) out.job_schemas = { job_attributes: b.jobSchema };
  if (b.strings) out.strings = b.strings;
  if (b.declarations) out.declarations = b.declarations;
  if (b.lists) out.lists = b.lists;
  const request: ModulePreviewRequest = {
    kind,
    definition: { ...definition, kind },
    bundle: out,
    context: context as unknown as Record<string, unknown>,
  };
  if (theme?.primaryColor || theme?.fontFamily) {
    request.theme = { primary_color: theme.primaryColor ?? null, font_family: theme.fontFamily ?? null };
  }
  return request;
}

/** What the build script records beside the build (public/module-preview/preview-build.json). */
export interface ModulePreviewBuild {
  module_version: string;
  built_at: string;
  commit: string;
}

let build: Promise<ModulePreviewBuild | null> | null = null;

/** The module preview this admin serves, or null when it has none (not built here); asked once per page load. */
export function modulePreviewBuild(): Promise<ModulePreviewBuild | null> {
  build ??= fetch(`${MODULE_PREVIEW_PATH}preview-build.json`, { cache: 'no-store' })
    .then(async (r) => (r.ok ? ((await r.json()) as ModulePreviewBuild) : null))
    .catch(() => null);
  return build;
}

/** A message from the module, whether it came as an object or as JSON text; null for anything else. */
export function readModuleMessage(data: unknown): Record<string, unknown> | null {
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(data) ? data : null;
}
