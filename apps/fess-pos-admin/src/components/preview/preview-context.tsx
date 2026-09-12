'use client';

// Shared state of one phone preview (T3-23): the sample data rules and bindings read, content strings, declarations,
// the bundle of referenced definitions, the focused element and in-phone navigation. Rule evaluation goes through the
// shared engine so the preview behaves like the phone.
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { evaluate, type ResolveContext, type ResolveLists, renderTemplate } from '@/lib/engine';
import type { PreviewBundle } from './definition-preview';
import type { PreviewContext, PreviewJob } from './sample-context';

export type PreviewTarget = { page: string } | { flow: string };

export interface PreviewEnv {
  /** Rule / binding data: today, job, agent, inspection (with a sample receipt), stats, previous. */
  data: Record<string, unknown>;
  context: PreviewContext;
  jobs: PreviewJob[];
  strings: Readonly<Record<string, string>>;
  declarations: Readonly<Record<string, { title: string; text: string }>>;
  bundle: PreviewBundle;
  lists: ResolveLists;
  focus: string | null;
  /** In-phone navigation (tap targets); absent outside an app preview. */
  navigate?: (target: PreviewTarget) => void;
}

const PreviewEnvContext = createContext<PreviewEnv | null>(null);

export function PreviewEnvProvider({ value, children }: { value: PreviewEnv; children: ReactNode }) {
  return <PreviewEnvContext.Provider value={value}>{children}</PreviewEnvContext.Provider>;
}

export function usePreviewEnv(): PreviewEnv {
  const env = useContext(PreviewEnvContext);
  if (!env) throw new Error('usePreviewEnv must be used inside <PreviewEnvProvider>');
  return env;
}

/** The engine's resolve context (today, job, agent, inspection, stats, previous) from the preview data. */
export function useResolveContext(): ResolveContext {
  const { data } = usePreviewEnv();
  return useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const k of ['today', 'job', 'agent', 'inspection', 'stats', 'config', 'previous']) if (data[k] !== undefined) out[k] = data[k];
    return out as ResolveContext;
  }, [data]);
}

/** What a screen puts in the phone frame. Screens hand these to a `renderFrame`, so the app shell can wrap them. */
export interface FrameParts {
  title?: ReactNode;
  showBack?: boolean;
  onBack?: () => void;
  banner?: ReactNode;
  body: ReactNode;
  footer?: ReactNode;
  overlay?: ReactNode;
}
export type RenderFrame = (parts: FrameParts) => ReactNode;

/** Scroll an element with `data-preview-anchor={key}` inside `root` into view. */
export function scrollToAnchor(root: HTMLElement | null, key: string): void {
  if (!root) return;
  const el = [...root.querySelectorAll<HTMLElement>('[data-preview-anchor]')].find((e) => e.dataset.previewAnchor === key);
  // tall elements (a whole section) scroll to their start, small ones (a field) to the middle
  el?.scrollIntoView({ block: el.offsetHeight > 240 ? 'start' : 'center', behavior: 'smooth' });
}

/** Evaluate a rule-able boolean (literal or expression). Errors fall back to `fallback` (the phone logs and shows). */
export function ruleBool(expr: unknown, data: unknown, fallback = true, today?: string | null): boolean {
  if (expr === undefined) return fallback;
  if (typeof expr === 'boolean') return expr;
  try {
    const v = evaluate(expr, data as Parameters<typeof evaluate>[1], { today: today ?? null });
    return v === null ? false : typeof v === 'boolean' ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Render a `{{template}}` against data (missing values render empty, as on the phone). */
export function templateText(template: unknown, data: unknown): string {
  if (typeof template !== 'string') return '';
  try {
    return renderTemplate(template, data as Parameters<typeof renderTemplate>[1]);
  } catch {
    return template;
  }
}

/** Resolve a content-string reference: a known content key → its string, otherwise the text itself. */
export function contentText(strings: Readonly<Record<string, string>>, keyOrText: string | undefined | null): string {
  if (!keyOrText) return '';
  return strings[keyOrText] ?? keyOrText;
}
