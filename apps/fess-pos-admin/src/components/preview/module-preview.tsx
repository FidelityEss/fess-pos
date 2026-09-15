'use client';

// The phone app itself as the preview (T3-12, D-101): the module's web build in an iframe, in a phone of a real phone's
// width, scaled down only to fit the column it sits in. It is sent each draft over postMessage (module-preview-bridge.ts)
// and answers with what it couldn't use. If it doesn't start (not built here, or too slow), onUnavailable hands over to
// the drawing (definition-preview.tsx). Nothing done in it is kept: the module draws in its preview sandbox (D-90).
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  MODULE_PHONE,
  MODULE_PREVIEW_PATH,
  type ModulePreviewRequest,
  PREVIEW_READY,
  PREVIEW_RENDER,
  PREVIEW_RENDERED,
  readModuleMessage,
} from './module-preview-bridge';

/** The phone's bezel, as the drawing's PhoneFrame has it. */
const BEZEL = 10;
/** How long the app may take to start before the drawing takes over (a first visit downloads about 10 MB). */
const START_TIMEOUT_MS = 45_000;
/** Drafts change as you type; the app is sent the latest after a short pause. */
const SEND_DELAY_MS = 250;

export interface ModulePhoneProps {
  request: ModulePreviewRequest;
  /** Screen height in CSS pixels (default: a real phone's, 844). */
  height?: number;
  /** Changing it sends the draft again, which starts the app's screens from the beginning. */
  restartToken?: number;
  onUnavailable: (why: string) => void;
  /** What the app said it couldn't use in the draft (e.g. an app definition's problems), after each draft. */
  onProblems?: (problems: string[]) => void;
  /** The module's version, once it says it's ready. */
  onReady?: (moduleVersion: string | null) => void;
  className?: string;
}

export function ModulePhone({ request, height = MODULE_PHONE.height, restartToken = 0, onUnavailable, onProblems, onReady, className }: ModulePhoneProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const [ready, setReady] = useState(false);
  const callbacks = useRef({ onUnavailable, onProblems, onReady });
  useEffect(() => {
    callbacks.current = { onUnavailable, onProblems, onReady };
  });

  // The column's width decides the scale; a hidden column (width 0) doesn't load the app at all.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const mounted = boxWidth > 0;

  // Messages from this frame only, from this admin's own origin.
  useEffect(() => {
    if (!mounted) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frameRef.current?.contentWindow) return;
      const message = readModuleMessage(e.data);
      if (!message) return;
      if (message.type === PREVIEW_READY) {
        setReady(true);
        callbacks.current.onReady?.(typeof message.module_version === 'string' ? message.module_version : null);
      } else if (message.type === PREVIEW_RENDERED) {
        const problems = Array.isArray(message.problems) ? message.problems.filter((p): p is string => typeof p === 'string') : [];
        callbacks.current.onProblems?.(problems);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [mounted]);

  useEffect(() => {
    if (!mounted || ready) return;
    const t = setTimeout(() => callbacks.current.onUnavailable('The phone app took too long to start here.'), START_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [mounted, ready]);

  // Each draft (and each restart) goes to the app, as JSON text so numbers arrive as they were written.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      frameRef.current?.contentWindow?.postMessage(JSON.stringify({ type: PREVIEW_RENDER, version: 1, request }), window.location.origin);
    }, SEND_DELAY_MS);
    return () => clearTimeout(t);
  }, [ready, request, restartToken]);

  const outerW = MODULE_PHONE.width + 2 * BEZEL;
  const outerH = height + 2 * BEZEL;
  const scale = Math.min(1, boxWidth / outerW) || 1;
  return (
    <div ref={boxRef} className={cn('w-full', className)}>
      {mounted ? (
        <div className="relative mx-auto" style={{ width: outerW * scale, height: outerH * scale }}>
          <div
            className="absolute left-0 top-0 origin-top-left overflow-hidden rounded-[38px] border-slate-900 bg-slate-900"
            style={{ width: outerW, height: outerH, borderWidth: BEZEL, transform: `scale(${scale})` }}
          >
            <iframe
              ref={frameRef}
              src={MODULE_PREVIEW_PATH}
              title="The phone app, showing your draft"
              className="block rounded-[28px] bg-white"
              style={{ width: MODULE_PHONE.width, height, border: 0 }}
              onError={() => callbacks.current.onUnavailable('The phone app could not be loaded here.')}
            />
            {ready ? null : (
              <div className="absolute inset-0 flex items-center justify-center rounded-[28px] bg-white p-8 text-center text-sm text-muted-foreground">
                Starting the phone app…
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
