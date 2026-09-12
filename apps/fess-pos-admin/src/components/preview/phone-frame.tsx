'use client';

// Phone mock-up used by the live previews (remote config, definitions studio). Interim until the embedded real-module
// web preview (T3-12): it approximates the module, which looks like the FESS app (schema/design/tokens.json: green status
// bar and 60 px header with a round back button, Montserrat, 45 px / 5 px buttons, 12 px cards, white bottom nav).
// Sizes inside the frame are phone pixels on purpose: the frame does not scale with the admin text-size setting.
import { ArrowLeft, BatteryFull, type LucideIcon, Signal, Wifi } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { FESS } from '@/lib/brand';
import { cn } from '@/lib/utils';

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
    <div className="flex h-7 shrink-0 items-center justify-between bg-[var(--pp)] px-5 text-[12px] font-semibold text-white">
      <span>09:41</span>
      <span className="flex items-center gap-1">
        <Signal className="size-3.5" />
        <Wifi className="size-3.5" />
        <BatteryFull className="size-4" />
      </span>
    </div>
  );
}

export function PhoneBottomNav({ items }: { items: PhoneNavItem[] }) {
  return (
    <nav className="flex h-14 shrink-0 items-stretch border-t bg-white" style={{ borderColor: FESS.divider }}>
      {items.map((item) => {
        const cls = cn('flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px]', item.active ? 'font-semibold text-[var(--pp)]' : 'font-medium');
        const style = item.active ? undefined : { color: FESS.textMuted };
        const icon = <item.icon className="size-5" style={item.active ? undefined : { color: FESS.navInactive }} />;
        return item.onSelect ? (
          <button key={item.label} type="button" onClick={item.onSelect} aria-current={item.active ? 'page' : undefined} className={cn(cls, 'hover:bg-slate-50')} style={style}>
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
    fontFamily: theme?.fontFamily || FESS.fontFamily,
  } as CSSProperties;
  const back = (
    <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full border-2 border-white/90">
      <ArrowLeft className="size-3.5" strokeWidth={2.75} />
    </span>
  );
  return (
    <figure className={cn('mx-auto shrink-0', className)} style={{ width }}>
      <div className="rounded-[38px] border-[10px] border-slate-900 bg-slate-900 shadow-xl" style={style}>
        <div
          className="relative flex flex-col overflow-hidden rounded-[28px] text-[14px] leading-[1.4]"
          style={{ height, backgroundColor: FESS.bgHome, color: FESS.textBody }}
        >
          <StatusBar />
          {title !== undefined ? (
            <div className="flex shrink-0 items-center gap-3 bg-[var(--pp)] px-4 text-white" style={{ height: FESS.header.height }}>
              {showBack ? (
                onBack ? (
                  <button type="button" onClick={onBack} aria-label="Back" className="rounded-full hover:bg-white/15">
                    {back}
                  </button>
                ) : (
                  back
                )
              ) : null}
              <span className="truncate text-[16px] font-semibold">{title}</span>
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

export function PhoneBanner({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode }) {
  const tones = {
    info: 'bg-sky-50 text-sky-900 border-sky-200',
    warning: 'bg-amber-50 text-amber-900 border-amber-200',
    danger: 'bg-red-50 text-red-900 border-red-200',
    success: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  } as const;
  return <div className={cn('shrink-0 border-b px-3 py-2 text-[13px] font-medium', tones[tone])}>{children}</div>;
}

export function PhoneSection({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('px-3 pt-3', className)}>
      {title ? <h3 className="mb-1.5 text-[13px] font-bold text-black">{title}</h3> : null}
      {children}
    </section>
  );
}

export function PhoneCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[12px] border bg-white p-3', className)} style={{ borderColor: FESS.divider, boxShadow: FESS.shadowCard }}>
      {children}
    </div>
  );
}

export function PhoneButton({ children, variant = 'primary', disabled = false }: { children: ReactNode; variant?: 'primary' | 'outline'; disabled?: boolean }) {
  return (
    <span
      className={cn(
        'flex w-full items-center justify-center rounded-[5px] text-[14px] font-semibold',
        variant === 'primary' ? 'bg-[var(--pp)] text-white' : 'border-2 border-[var(--pp)] bg-white text-[var(--pp)]',
        disabled && 'opacity-40',
      )}
      style={{ height: FESS.buttonHeight }}
    >
      {children}
    </span>
  );
}

export function PhoneChip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700',
    primary: 'bg-[color-mix(in_srgb,var(--pp)_12%,white)] text-[var(--pp)]',
    success: 'bg-emerald-50 text-emerald-800',
    warning: 'bg-amber-50 text-amber-800',
    danger: 'bg-red-50 text-red-800',
  } as const;
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', tones[tone])}>{children}</span>;
}
