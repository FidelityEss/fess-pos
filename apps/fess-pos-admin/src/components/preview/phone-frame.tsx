'use client';

// Phone mock-up used by the live previews (remote config, definitions studio). Interim until the embedded real-module
// web preview (T3-12): it mirrors the module's FESS look (docs/14 §2, D-97; schema/design/tokens.json through
// src/lib/brand.ts): a green status bar and 60 px header with a centred title and an outlined round back button, white
// pages with 32 px side padding, no shadows anywhere, Montserrat, 45 px / 5 px buttons, bordered boxes only where one
// is needed, and a white bottom bar under a hairline.
// Sizes inside the frame are phone pixels on purpose: the frame does not scale with the admin text-size setting.
import { ArrowLeft, BatteryFull, type LucideIcon, Signal, Wifi } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { FESS, fessTint } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { BUTTON_BASE, BUTTON_LOOK, BUTTON_OFF, BUTTON_STYLE, type FessTone, PAGE_X, PHONE_VARS, toneColors, typeStyle } from './phone-style';

export interface PhoneTheme {
  primaryColor?: string | null;
  fontFamily?: string | null;
}

/** Default accent: the FESS brand primary (remote config theme.primary_color null = the FESS brand). */
export const PHONE_DEFAULT_PRIMARY = FESS.primary;

export interface PhoneNavItem {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  /** Makes the tab tappable (interactive previews). */
  onSelect?: () => void;
}

/** Status bar in the header colour, as FESS paints it (a zero-height AppBar in appBarColour). */
function StatusBar() {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between bg-[var(--pp)] px-5 text-[12px] font-semibold" style={{ color: FESS.header.title.color }}>
      <span>09:41</span>
      <span className="flex items-center gap-1">
        <Signal className="size-3.5" />
        <Wifi className="size-3.5" />
        <BatteryFull className="size-4" />
      </span>
    </div>
  );
}

/** FESS's bottom bar: white under a hairline, the active item green, the rest body grey, labels one size, no pill. */
export function PhoneBottomNav({ items }: { items: PhoneNavItem[] }) {
  const nav = FESS.bottomNav;
  return (
    <nav className="flex h-14 shrink-0 items-stretch border-t" style={{ backgroundColor: nav.background, borderColor: nav.border }}>
      {items.map((item) => {
        const cls = 'flex flex-1 flex-col items-center justify-center gap-0.5 leading-tight';
        const style: CSSProperties = {
          color: item.active ? 'var(--pp)' : nav.inactiveItem,
          fontSize: nav.labelSize,
          fontWeight: item.active ? 600 : nav.labelWeight,
        };
        const icon = <item.icon className="size-6" />;
        return item.onSelect ? (
          <button key={item.label} type="button" onClick={item.onSelect} aria-current={item.active ? 'page' : undefined} className={cn(cls, 'cursor-pointer')} style={style}>
            {icon}
            {item.label}
          </button>
        ) : (
          <span key={item.label} className={cls} style={style}>
            {icon}
            {item.label}
          </span>
        );
      })}
    </nav>
  );
}

/**
 * A phone: status bar, optional header (title, back), optional banner under it, scrolling body, optional footer and bottom
 * navigation. `theme` sets the accent colour (var(--pp)) and font as remote config `theme.*` would; both default to FESS.
 */
export function PhoneFrame({
  title,
  showBack = false,
  banner,
  bottomNav,
  theme,
  caption,
  width = 320,
  height = 640,
  className,
  children,
  onBack,
  footer,
  overlay,
}: {
  title?: ReactNode;
  showBack?: boolean;
  /** Makes the header back button tappable (shown when showBack). */
  onBack?: () => void;
  /** Fixed area under the scrolling body (e.g. Back / Next buttons). */
  footer?: ReactNode;
  /** Rendered over the whole screen (in-phone dialogs). */
  overlay?: ReactNode;
  banner?: ReactNode;
  bottomNav?: PhoneNavItem[];
  theme?: PhoneTheme;
  /** false hides the caption under the frame. */
  caption?: ReactNode | false;
  width?: number;
  height?: number;
  className?: string;
  children?: ReactNode;
}) {
  const style = {
    '--pp': theme?.primaryColor || PHONE_DEFAULT_PRIMARY,
    ...PHONE_VARS,
    fontFamily: theme?.fontFamily || FESS.fontFamily,
  } as CSSProperties;
  const b = FESS.header.back;
  // custom_app_bar_widget: a 1 px white ring round a white arrow, not a filled circle.
  const back = (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: b.size, height: b.size, color: b.color, border: b.style === 'outline' ? `${b.borderWidth}px solid ${b.color}` : undefined }}
    >
      <ArrowLeft style={{ width: b.iconSize, height: b.iconSize }} strokeWidth={2.75} />
    </span>
  );
  const h = FESS.header;
  return (
    <figure className={cn('mx-auto shrink-0', className)} style={{ width }}>
      <div className="rounded-[38px] border-[10px] border-slate-900 bg-slate-900" style={style}>
        <div
          className="relative flex flex-col overflow-hidden rounded-[28px] text-[14px] leading-[1.4]"
          style={{ height, backgroundColor: FESS.page.background, color: FESS.textBody }}
        >
          <StatusBar />
          {title !== undefined ? (
            // A centred title: with a back button, an empty slot of the same size on the right keeps it centred.
            <div
              className={cn('grid shrink-0 items-center gap-2 bg-[var(--pp)]', showBack ? 'grid-cols-[auto_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)]')}
              style={{ height: h.height, paddingLeft: h.paddingX, paddingRight: h.paddingX, color: h.title.color }}
            >
              {showBack ? (
                onBack ? (
                  <button type="button" onClick={onBack} aria-label="Back" className="cursor-pointer rounded-full hover:bg-white/15">
                    {back}
                  </button>
                ) : (
                  back
                )
              ) : null}
              <span
                className="truncate"
                style={{ fontSize: h.title.size, fontWeight: h.title.weight, textAlign: h.title.align as CSSProperties['textAlign'] }}
              >
                {title}
              </span>
              {showBack ? <span aria-hidden style={{ width: b.size }} /> : null}
            </div>
          ) : null}
          {banner}
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer}
          {bottomNav ? <PhoneBottomNav items={bottomNav} /> : null}
          {overlay}
        </div>
      </div>
      {caption === false ? null : (
        <figcaption className="mt-2 text-center text-xs text-muted-foreground">
          {caption ?? 'Approximate preview. The phone app shows the same content and settings; small visual details may differ.'}
        </figcaption>
      )}
    </figure>
  );
}

// ── Building blocks for preview screens (FESS styling) ──────────────────────────────────────────

/** A strip under the header: a light tint of its tone with dark text of the same family, over a hairline. */
export function PhoneBanner({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode }) {
  const colors = toneColors(tone);
  return (
    <div className={cn('shrink-0 border-b py-2 text-[13px] font-medium leading-snug', PAGE_X)} style={{ backgroundColor: colors.background, color: colors.foreground, borderColor: FESS.divider }}>
      {children}
    </div>
  );
}

export function PhoneSection({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn(PAGE_X, 'pt-4', className)}>
      {title ? (
        <h3 className="mb-2 leading-tight" style={{ ...typeStyle('title'), color: FESS.text }}>
          {title}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

/** A box, only where one is needed (component.card, D-97): white, a 1 px light border, 12 px corners, no shadow. */
export function PhoneCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-[var(--ph-card-r)] border-[length:var(--ph-card-bw)] border-[color:var(--ph-card-border)] bg-[color:var(--ph-card-bg)] p-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PhoneButton({ children, variant = 'primary', disabled = false }: { children: ReactNode; variant?: 'primary' | 'outline'; disabled?: boolean }) {
  return (
    <span className={cn(BUTTON_BASE, 'w-full', BUTTON_LOOK[variant], disabled && BUTTON_OFF[variant])} style={BUTTON_STYLE}>
      {children}
    </span>
  );
}

/** Chip tones: the module's (status colours, gold `accent` for work in hand) plus `primary`, a tint of the accent. */
export type PhoneChipTone = 'neutral' | 'primary' | FessTone;

/** A status chip (component.chip): a pill tinted in its tone's colour with dark text of the same family. */
export function PhoneChip({ children, tone = 'neutral' }: { children: ReactNode; tone?: PhoneChipTone }) {
  const colors = tone === 'primary' ? { background: fessTint('var(--pp)'), foreground: 'var(--pp)' } : toneColors(tone);
  const chip = FESS.chip;
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 leading-snug [&_svg]:shrink-0"
      style={{
        backgroundColor: colors.background,
        color: colors.foreground,
        borderRadius: chip.radius,
        padding: `${chip.paddingY}px ${chip.paddingX}px`,
        fontSize: chip.textSize,
        fontWeight: chip.textWeight,
      }}
    >
      {children}
    </span>
  );
}
