'use client';

// A form on the phone (T3-23): one section per screen with Back / Next, or one scrolling page. Next and Submit run the
// engine validation for the fields on screen and show the phone's messages.
import { useEffect, useRef, useState } from 'react';
import type { FormDefinition } from '@/lib/engine';
import { PhoneBanner } from './phone-frame';
import { PhoneActionButton, PhoneDialog, StepIndicator, StickyFooter } from './phone-widgets';
import { FormSections } from './form-renderer';
import { type FormPreviewState, useFormPreviewState } from './form-state';
import { type RenderFrame, scrollToAnchor, usePreviewEnv, useResolveContext } from './preview-context';
import { humanise } from './preview-format';

export type FormMode = 'screens' | 'scroll';

export function sectionTitle(form: FormDefinition, key: string): string {
  const s = form.sections.find((x) => x.key === key);
  return s && typeof s.title === 'string' ? s.title : humanise(key);
}

/** Validate, and on failure scroll to the first field with a message. Returns true when valid. */
export function validateAndReveal(state: FormPreviewState, sectionKeys: readonly string[] | undefined, root: HTMLElement | null): boolean {
  const errors = state.validate(sectionKeys);
  const first = Object.keys(errors)[0];
  if (first === undefined) return true;
  requestAnimationFrame(() => scrollToAnchor(root, first));
  return false;
}

export function ErrorBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return <PhoneBanner tone="danger">{count === 1 ? 'Check 1 answer before you continue.' : `Check ${count} answers before you continue.`}</PhoneBanner>;
}

export function FormScreen({
  form,
  renderFrame,
  title,
  mode,
  current,
  onCurrentChange,
  sectionKeys,
  submitLabel = 'Submit',
  onSubmitted,
  showBack,
  onBack,
}: {
  form: FormDefinition;
  renderFrame: RenderFrame;
  title?: string;
  mode: FormMode;
  current: string | null;
  onCurrentChange: (key: string) => void;
  sectionKeys?: readonly string[];
  submitLabel?: string;
  /** Called after a valid submit; without it the preview shows a "ready to submit" dialog. */
  onSubmitted?: () => void;
  showBack?: boolean;
  onBack?: () => void;
}) {
  const env = usePreviewEnv();
  const rctx = useResolveContext();
  const state = useFormPreviewState(form, rctx, env.lists);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  const all = sectionKeys ?? form.sections.map((s) => s.key);
  const visible = all.filter((k) => state.resolved?.sections[k]?.visible !== false);
  const errorCount = Object.keys(state.errors).length;
  const pageKey = mode === 'scroll' || visible.length <= 1 ? '*' : (visible[Math.max(0, current ? visible.indexOf(current) : 0)] ?? '*');
  const { clearErrors } = state;
  // Messages belong to the screen that raised them: clear them when another section is shown (e.g. from the picker).
  useEffect(() => {
    clearErrors();
  }, [pageKey, clearErrors]);

  const submit = () => {
    if (!validateAndReveal(state, all, bodyRef.current)) return;
    if (onSubmitted) onSubmitted();
    else setDone(true);
  };

  const dialog = done ? (
    <PhoneDialog title="Ready to submit" actions={<PhoneActionButton onClick={() => setDone(false)}>Close</PhoneActionButton>}>
      Every answer passes the phone’s checks. On the phone, this is where the answers are sealed and sent.
    </PhoneDialog>
  ) : undefined;

  if (mode === 'scroll' || visible.length <= 1) {
    return renderFrame({
      title: title ?? form.title ?? 'Form',
      showBack,
      onBack,
      banner: <ErrorBanner count={errorCount} />,
      body: (
        <div ref={bodyRef}>
          <FormSections state={state} sectionKeys={all} />
        </div>
      ),
      footer: (
        <StickyFooter>
          <PhoneActionButton onClick={submit}>{submitLabel}</PhoneActionButton>
        </StickyFooter>
      ),
      overlay: dialog,
    });
  }

  const index = Math.max(0, current ? visible.indexOf(current) : 0);
  const key = visible[index] ?? visible[0] ?? '';
  const last = index >= visible.length - 1;
  const next = () => {
    if (!validateAndReveal(state, [key], bodyRef.current)) return;
    state.clearErrors();
    const target = visible[index + 1];
    if (target) onCurrentChange(target);
  };
  return renderFrame({
    title: title ?? form.title ?? 'Form',
    showBack: showBack || index > 0,
    onBack: index > 0 ? () => onCurrentChange(visible[index - 1] ?? key) : onBack,
    banner: (
      <>
        <StepIndicator index={index} total={visible.length} label={sectionTitle(form, key)} />
        <ErrorBanner count={errorCount} />
      </>
    ),
    body: (
      <div ref={bodyRef}>
        <FormSections state={state} sectionKeys={[key]} />
      </div>
    ),
    footer: (
      <StickyFooter>
        {index > 0 ? (
          <PhoneActionButton variant="outline" onClick={() => onCurrentChange(visible[index - 1] ?? key)}>
            Back
          </PhoneActionButton>
        ) : null}
        <PhoneActionButton onClick={last ? submit : next}>{last ? submitLabel : 'Next'}</PhoneActionButton>
      </StickyFooter>
    ),
    overlay: dialog,
  });
}
