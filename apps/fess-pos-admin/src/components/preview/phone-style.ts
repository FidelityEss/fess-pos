// The phone preview's look, from the design tokens through src/lib/brand.ts (docs/14 §2–3, D-97): white pages, flat
// pieces with no shadows, hairlines and light borders. PhoneFrame sets PHONE_VARS on the phone screen, so every piece
// inside can use the token values in class names (hover, focus and override classes keep working).
import type { CSSProperties } from 'react';
import { FESS, fessTint } from '@/lib/brand';

const px = (n: number) => `${n}px`;

/** CSS variables for everything inside the phone screen. */
export const PHONE_VARS = {
  '--ph-text': FESS.text,
  '--ph-body': FESS.textBody,
  '--ph-muted': FESS.textMuted,
  '--ph-on-primary': FESS.button.primary.text,
  '--ph-page': FESS.page.background,
  '--ph-subtle': FESS.bgSubtle,
  '--ph-divider': FESS.divider,
  '--ph-border': FESS.border,
  '--ph-warning': FESS.warning,
  '--ph-warning-text': FESS.warningText,
  '--ph-error': FESS.error,
  '--ph-error-text': FESS.errorText,
  '--ph-x': px(FESS.page.paddingX),
  '--ph-tint': `${Math.round(FESS.chip.tintOpacity * 1000) / 10}%`,
  '--ph-pill': px(FESS.chip.radius),
  '--ph-card-r': px(FESS.card.radius),
  '--ph-inner-r': px(FESS.card.innerRadius),
  '--ph-card-bg': FESS.card.background,
  '--ph-card-border': FESS.card.border,
  '--ph-card-bw': px(FESS.card.borderWidth),
  '--ph-control-r': px(FESS.button.radius),
  '--ph-btn-icon': px(FESS.button.iconSize),
  '--ph-outline-bg': FESS.button.outline.background,
  '--ph-outline-border': FESS.button.outline.border,
  '--ph-outline-bw': px(FESS.button.outline.borderWidth),
  '--ph-outline-text': FESS.button.outline.text,
  '--ph-danger-bg': FESS.button.danger.background,
  '--ph-danger-text': FESS.button.danger.text,
  '--ph-disabled-bg': FESS.button.disabled.background,
  '--ph-disabled-text': FESS.button.disabled.text,
  '--ph-input-r': px(FESS.input.radius),
  '--ph-input-bg': FESS.input.background,
  '--ph-input-border': FESS.input.border,
  '--ph-input-bw': px(FESS.input.borderWidth),
  '--ph-input-text': FESS.input.text,
  '--ph-input-hint': FESS.input.hint,
  '--ph-input-icon': FESS.input.icon,
  '--ph-input-x': px(FESS.input.paddingX),
} as CSSProperties;

type TypeRole = keyof typeof FESS.type;

/** Font size and weight of a phone type role (type.phone), for a `style` prop. */
export function typeStyle(role: TypeRole): CSSProperties {
  return { fontSize: FESS.type[role].size, fontWeight: FESS.type[role].weight };
}

/** What a chip, a notice or a status icon means (the module's PosTone). Colour is kept for meaning. */
export type FessTone = 'neutral' | 'info' | 'accent' | 'success' | 'warning' | 'danger';

/** A tone's colours: a light tint of the status colour behind dark text of the same family (≥ 4.5:1). */
export function toneColors(tone: FessTone): { background: string; foreground: string } {
  switch (tone) {
    case 'success':
      return { background: fessTint(FESS.successText), foreground: FESS.successText };
    case 'accent':
      return { background: fessTint(FESS.gold), foreground: FESS.goldTextStrong };
    case 'info':
      return { background: fessTint(FESS.info), foreground: FESS.infoText };
    case 'warning':
      return { background: fessTint(FESS.warning), foreground: FESS.warningText };
    case 'danger':
      return { background: fessTint(FESS.error), foreground: FESS.errorText };
    default:
      return { background: FESS.bgSubtle, foreground: FESS.textBody };
  }
}

/** A light tint of the accent (var(--pp)), as a background class. */
export const PP_TINT_BG = 'bg-[color-mix(in_srgb,var(--pp)_var(--ph-tint),var(--ph-page))]';

/** Side padding of page content, and the negative margin that lets an edge-to-edge piece span the page. */
export const PAGE_X = 'px-[var(--ph-x)]';
export const PAGE_BLEED = '-mx-[var(--ph-x)]';

export type PhoneButtonVariant = 'primary' | 'outline' | 'text' | 'danger';

/** Buttons (component.button): 45 px high (set as a style), 5 px corners, semibold, an optional 15 px leading icon. */
export const BUTTON_BASE = 'flex items-center justify-center gap-1.5 rounded-[var(--ph-control-r)] px-4 leading-tight [&_svg]:size-[var(--ph-btn-icon)] [&_svg]:shrink-0';

/** Primary green; secondary white with a 2 px gold outline and dark text; destructive FESS red. */
export const BUTTON_LOOK: Record<PhoneButtonVariant, string> = {
  primary: 'bg-[var(--pp)] text-[color:var(--ph-on-primary)]',
  outline: 'border-[length:var(--ph-outline-bw)] border-[color:var(--ph-outline-border)] bg-[color:var(--ph-outline-bg)] text-[color:var(--ph-outline-text)]',
  text: 'text-[var(--pp)] hover:bg-[color-mix(in_srgb,var(--pp)_8%,var(--ph-page))]',
  danger: 'bg-[color:var(--ph-danger-bg)] text-[color:var(--ph-danger-text)]',
};

/** The disabled look of a static mock-up button. */
export const BUTTON_OFF: Record<PhoneButtonVariant, string> = {
  primary: 'bg-[color:var(--ph-disabled-bg)] text-[color:var(--ph-disabled-text)]',
  outline: 'border-[color:var(--ph-disabled-bg)] text-[color:var(--ph-disabled-text)]',
  text: 'opacity-40',
  danger: 'bg-[color:var(--ph-disabled-bg)] text-[color:var(--ph-disabled-text)]',
};

/** The disabled look of a real <button> while it is disabled. */
export const BUTTON_OFF_WHEN_DISABLED: Record<PhoneButtonVariant, string> = {
  primary: 'disabled:bg-[color:var(--ph-disabled-bg)] disabled:text-[color:var(--ph-disabled-text)]',
  outline: 'disabled:border-[color:var(--ph-disabled-bg)] disabled:text-[color:var(--ph-disabled-text)]',
  text: 'disabled:opacity-40',
  danger: 'disabled:bg-[color:var(--ph-disabled-bg)] disabled:text-[color:var(--ph-disabled-text)]',
};

/** Button height and text, from the tokens. */
export const BUTTON_STYLE: CSSProperties = { height: FESS.button.height, fontSize: FESS.button.textSize, fontWeight: FESS.button.textWeight };

/** Focus-highlight ring offset in the page colour (the studio's "show me this" outline, not a shadow). */
export const RING_OFFSET = 'ring-offset-[var(--ph-page)]';
