'use client';

// Phone-styled building blocks for the definition preview (T3-23). They mirror the module's FESS look (docs/14 §2, D-97;
// the tokens through ./phone-style): white and flat, 2 px light-grey fields that turn green with focus, gold-outlined
// secondary buttons, tinted notices with dark text. Sizes are phone pixels on purpose — everything here renders inside
// <PhoneFrame>, which does not follow the admin text-size setting.
import { Check, ChevronDown, CircleAlert, CircleCheck, Info, MapPin, Megaphone, TriangleAlert, User } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { FESS } from '@/lib/brand';
import { cn } from '@/lib/utils';
import {
  BUTTON_BASE,
  BUTTON_LOOK,
  BUTTON_OFF_WHEN_DISABLED,
  BUTTON_STYLE,
  type FessTone,
  PAGE_X,
  type PhoneButtonVariant,
  PP_TINT_BG,
  RING_OFFSET,
  toneColors,
  typeStyle,
} from './phone-style';

export interface ChoiceOption {
  value: string;
  label: string;
  help_text?: string;
}

// ── Notices and placeholders ──────────────────────────────────────────────────────────────────────

/** A gentle in-phone note about something the preview cannot show (never an error screen). */
export function PreviewNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-[var(--ph-inner-r)] border border-dashed border-[color:var(--ph-border)] bg-[color:var(--ph-page)] px-3 py-2 text-[13px] leading-snug text-[color:var(--ph-body)]',
        className,
      )}
    >
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A component or type this preview does not draw yet. */
export function UnknownElement({ type, anchor, highlighted }: { type: string; anchor?: string; highlighted?: boolean }) {
  return (
    <div
      data-preview-anchor={anchor}
      className={cn(
        'rounded-[var(--ph-inner-r)] border border-dashed border-[color:var(--ph-border)] bg-[color:var(--ph-subtle)] px-3 py-2.5 text-[13px] text-[color:var(--ph-body)]',
        highlighted && cn('ring-2 ring-[var(--pp)] ring-offset-2', RING_OFFSET),
      )}
    >
      This part can’t be previewed yet (<span className="font-mono">{type}</span>).
    </div>
  );
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function toTone(v: unknown, fallback: Tone = 'info'): Tone {
  return v === 'neutral' || v === 'info' || v === 'success' || v === 'warning' || v === 'danger' ? v : fallback;
}

const TONE_ICON: Record<Tone, typeof Info> = { neutral: Megaphone, info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert };

/**
 * A notice: a light tint of its tone with dark text of the same family, 8 px corners, no border (the module's banner).
 * `icon={false}` is the plainer notice a form shows.
 */
export function Callout({ tone, children, className, icon = true }: { tone: Tone; children: ReactNode; className?: string; icon?: boolean }) {
  const colors = toneColors(tone as FessTone);
  const Icon = TONE_ICON[tone];
  return (
    <div
      className={cn('flex items-start gap-3 rounded-[var(--ph-inner-r)] leading-snug', icon ? 'p-4' : 'p-3', className)}
      style={{ ...typeStyle('body'), backgroundColor: colors.background, color: colors.foreground }}
    >
      {icon ? <Icon className="mt-px size-5 shrink-0" /> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export type RiskLevel = 'info' | 'elevated' | 'high';

export function RiskChip({ level, label }: { level: RiskLevel; label?: string }) {
  const tone: Record<RiskLevel, FessTone> = { info: 'info', elevated: 'warning', high: 'danger' };
  const colors = toneColors(tone[level]);
  const names: Record<RiskLevel, string> = { info: 'Note', elevated: 'Elevated risk', high: 'High risk' };
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 leading-snug"
      style={{
        backgroundColor: colors.background,
        color: colors.foreground,
        borderRadius: FESS.chip.radius,
        padding: `${FESS.chip.paddingY}px ${FESS.chip.paddingX}px`,
        fontSize: FESS.chip.textSize,
        fontWeight: FESS.chip.textWeight,
      }}
    >
      <TriangleAlert className="size-3 shrink-0" />
      {label ? `${names[level]} · ${label}` : names[level]}
    </span>
  );
}

// ── Field shell ───────────────────────────────────────────────────────────────────────────────────

/** A field's label (with `*` when required), help, input, risk and problems, as the module's form frame. */
export function FieldShell({
  anchor,
  label,
  required,
  helpText,
  errors,
  risk,
  highlighted,
  className,
  children,
}: {
  anchor?: string;
  label?: ReactNode;
  required?: boolean;
  helpText?: ReactNode;
  errors?: readonly string[];
  risk?: { level: RiskLevel; label?: string } | null;
  highlighted?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-preview-anchor={anchor}
      className={cn('scroll-mt-6 rounded-[var(--ph-inner-r)] transition-shadow', highlighted && cn('ring-2 ring-[var(--pp)] ring-offset-4', RING_OFFSET), className)}
    >
      {label ? (
        <div className="mb-1 leading-snug text-[color:var(--ph-text)]" style={typeStyle('body')}>
          {label}
          {required ? <span title="Required"> *</span> : null}
        </div>
      ) : null}
      {helpText ? (
        <p className="-mt-0.5 mb-1.5 leading-snug text-[color:var(--ph-body)]" style={typeStyle('caption')}>
          {helpText}
        </p>
      ) : null}
      {children}
      {risk ? (
        <div className="mt-1.5">
          <RiskChip level={risk.level} label={risk.label} />
        </div>
      ) : null}
      {errors && errors.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {errors.map((e) => (
            <li key={e} className="leading-snug text-[color:var(--ph-error-text)]" style={typeStyle('caption')}>
              {e}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ── Inputs ────────────────────────────────────────────────────────────────────────────────────────

// component.input: white, a 2 px light grey border, 8 px corners, 16 px side padding, green with focus. No focus glow.
const INPUT =
  'h-12 w-full min-w-0 rounded-[var(--ph-input-r)] border-[length:var(--ph-input-bw)] border-[color:var(--ph-input-border)] bg-[color:var(--ph-input-bg)] px-[var(--ph-input-x)] ' +
  'text-[14px] font-medium text-[color:var(--ph-input-text)] outline-none placeholder:text-[color:var(--ph-input-hint)] ' +
  'focus:border-[color:var(--pp)] disabled:bg-[color:var(--ph-subtle)] disabled:text-[color:var(--ph-body)]';

export function PhoneInput({ className, ...props }: React.ComponentProps<'input'>) {
  return <input {...props} className={cn(INPUT, className)} />;
}

export function PhoneTextArea({ className, rows = 3, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea rows={rows} {...props} className={cn(INPUT, 'h-auto py-3 leading-snug', className)} />;
}

export function PhoneSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  disabled,
  className,
}: {
  options: readonly ChoiceOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <select
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className={cn(INPUT, 'appearance-none pr-10', value === null && 'text-[color:var(--ph-input-hint)]')}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-[color:var(--ph-body)]" strokeWidth={2.5} />
    </div>
  );
}

function OptionText({ option }: { option: ChoiceOption }) {
  return (
    <span className="min-w-0 flex-1 py-1.5">
      <span className="block leading-snug text-[color:var(--ph-text)]" style={typeStyle('body')}>
        {option.label}
      </span>
      {option.help_text ? (
        <span className="block leading-snug text-[color:var(--ph-body)]" style={typeStyle('caption')}>
          {option.help_text}
        </span>
      ) : null}
    </span>
  );
}

const CHOICE_ROW = 'flex min-h-12 w-full items-center gap-3 rounded-[var(--ph-inner-r)] px-1 text-left hover:bg-[color:var(--ph-subtle)] disabled:opacity-60';

export function RadioList({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly ChoiceOption[];
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" className="-mx-1 grid">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(o.value)} className={CHOICE_ROW}>
            <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border-2', on ? 'border-[color:var(--pp)]' : 'border-[color:var(--ph-body)]')}>
              {on ? <span className="size-2.5 rounded-full bg-[var(--pp)]" /> : null}
            </span>
            <OptionText option={o} />
          </button>
        );
      })}
    </div>
  );
}

function CheckBox({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-[3px] border-2',
        on ? 'border-[color:var(--pp)] bg-[var(--pp)] text-[color:var(--ph-on-primary)]' : 'border-[color:var(--ph-body)] bg-[color:var(--ph-page)]',
      )}
    >
      {on ? <Check className="size-3.5" strokeWidth={3} /> : null}
    </span>
  );
}

export function CheckList({
  options,
  values,
  onToggle,
  disabled,
}: {
  options: readonly ChoiceOption[];
  values: readonly string[];
  onToggle: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="-mx-1 grid">
      {options.map((o) => (
        <button key={o.value} type="button" role="checkbox" aria-checked={values.includes(o.value)} disabled={disabled} onClick={() => onToggle(o.value)} className={CHOICE_ROW}>
          <CheckBox on={values.includes(o.value)} />
          <OptionText option={o} />
        </button>
      ))}
    </div>
  );
}

/** Choice chips: white pills with a light border; a chosen one is tinted in the accent with accent text. */
export function ChipGroup({
  options,
  selected,
  onToggle,
  disabled,
}: {
  options: readonly ChoiceOption[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onToggle(o.value)}
            className={cn(
              'inline-flex min-h-9 items-center gap-1 rounded-[var(--ph-pill)] border border-[color:var(--ph-border)] px-3 text-[14px]',
              on ? cn(PP_TINT_BG, 'font-semibold text-[var(--pp)]') : 'bg-[color:var(--ph-page)] font-medium text-[color:var(--ph-text)]',
            )}
          >
            {on ? <Check className="size-3.5" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly ChoiceOption[];
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex overflow-hidden rounded-[var(--ph-control-r)] border border-[color:var(--ph-border)] bg-[color:var(--ph-page)]">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-h-11 flex-1 px-2 text-[14px] font-semibold',
            i > 0 && 'border-l border-[color:var(--ph-border)]',
            o.value === value ? cn(PP_TINT_BG, 'text-[var(--pp)]') : 'text-[color:var(--ph-text)] hover:bg-[color:var(--ph-subtle)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A flat switch (no shadow): the accent thumb on a half-tint track when on. */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-[14px] font-medium text-[color:var(--ph-text)] disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">{label}</span>
      <span className={cn('relative h-6 w-10 shrink-0 rounded-full transition-colors', checked ? 'bg-[color-mix(in_srgb,var(--pp)_50%,var(--ph-page))]' : 'bg-[color:var(--ph-muted)]')}>
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full transition-all',
            checked ? 'left-[18px] bg-[var(--pp)]' : 'left-0.5 bg-[color:var(--ph-page)]',
          )}
        />
      </span>
    </button>
  );
}

export function CheckRow({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="-mx-1 flex min-h-11 w-full items-start gap-3 rounded-[var(--ph-inner-r)] px-1 py-1.5 text-left text-[14px] font-medium leading-snug text-[color:var(--ph-text)] hover:bg-[color:var(--ph-subtle)] disabled:opacity-60"
    >
      <span className="mt-0.5">
        <CheckBox on={checked} />
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

/** A button: primary green; `outline` the gold-outlined secondary with dark text; `danger` FESS red; `text` a link. */
export function PhoneActionButton({
  children,
  onClick,
  variant = 'primary',
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: PhoneButtonVariant;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(BUTTON_BASE, 'w-full cursor-pointer disabled:cursor-default', BUTTON_LOOK[variant], BUTTON_OFF_WHEN_DISABLED[variant], className)}
      style={BUTTON_STYLE}
    >
      {children}
    </button>
  );
}

/** The buttons at the foot of a page: on white under a hairline, in line with the page's side padding. */
export function StickyFooter({ children }: { children: ReactNode }) {
  return <div className={cn('flex shrink-0 gap-2 border-t border-[color:var(--ph-divider)] bg-[color:var(--ph-page)] pb-4 pt-3', PAGE_X)}>{children}</div>;
}

/** A modal sheet inside the phone (render it through PhoneFrame's `overlay`). Flat: no border, no shadow. */
export function PhoneDialog({ title, children, actions }: { title: ReactNode; children?: ReactNode; actions: ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex items-end bg-black/40 p-3">
      <div role="dialog" aria-label={typeof title === 'string' ? title : undefined} className="w-full rounded-[var(--ph-card-r)] bg-[color:var(--ph-page)] p-5">
        <div className="text-[color:var(--ph-text)]" style={typeStyle('title')}>
          {title}
        </div>
        {children ? (
          <div className="mt-2 text-[14px] font-medium leading-snug text-[color:var(--ph-body)]">{children}</div>
        ) : null}
        <div className="mt-4 flex gap-2">{actions}</div>
      </div>
    </div>
  );
}

export function StepIndicator({ index, total, label }: { index: number; total: number; label?: string }) {
  return (
    <div className={cn('shrink-0 border-b border-[color:var(--ph-divider)] bg-[color:var(--ph-page)] pb-2 pt-2', PAGE_X)}>
      <div className="flex items-center justify-between text-[12px] font-medium text-[color:var(--ph-body)]">
        <span>
          Step {index + 1} of {total}
        </span>
        {label ? <span className="truncate pl-2 font-semibold text-[color:var(--ph-text)]">{label}</span> : null}
      </div>
      <div className="mt-1.5 flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn('h-1 flex-1 rounded-full', i <= index ? 'bg-[var(--pp)]' : 'bg-[color:var(--ph-divider)]')} />
        ))}
      </div>
    </div>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────────────────────────

/** The agent's initials on the accent (component.avatar: brand green, never blue); a person icon without a name. */
export function Avatar({ firstName, lastName, size = 48 }: { firstName?: string; lastName?: string; size?: number }) {
  const initials = [firstName, lastName]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase())
    .join('');
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-[var(--pp)] font-semibold leading-none"
      style={{ width: size, height: size, fontSize: size * 0.35, color: FESS.avatar.foreground }}
    >
      {initials || <User style={{ width: size / 2, height: size / 2 }} />}
    </span>
  );
}

// ── Text ──────────────────────────────────────────────────────────────────────────────────────────

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(part))
      return (
        <code key={i} className="rounded bg-[color:var(--ph-subtle)] px-1 font-mono text-[13px]">
          {part.slice(1, -1)}
        </code>
      );
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** A small Markdown subset (paragraphs, line breaks, bullet lists, headings, **bold**, *italic*, `code`). */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim() !== '');
  return (
    <div className={cn('space-y-2 text-[14px] font-semibold leading-relaxed text-[color:var(--ph-body)]', className)}>
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-0.5 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*] /, ''))}</li>
              ))}
            </ul>
          );
        }
        const heading = /^(#{1,3}) (.*)$/.exec(block);
        if (heading)
          return (
            <div key={i} className="text-[color:var(--ph-text)]" style={typeStyle('title')}>
              {inline(heading[2] ?? '')}
            </div>
          );
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {inline(l)}
                {j < lines.length - 1 ? <br /> : null}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// ── Mock visuals (maps, photos, QR) ───────────────────────────────────────────────────────────────

/** A static stand-in for the offline map tiles: streets, the job pin and (optionally) the fence and the agent. */
export function MockMap({
  height = 160,
  fence = false,
  agent = null,
  className,
}: {
  height?: number;
  fence?: boolean;
  agent?: 'inside' | 'outside' | null;
  className?: string;
}) {
  const h = Math.max(80, Math.min(600, height));
  const cy = h / 2;
  const r = Math.min(h * 0.34, 70);
  return (
    <div
      className={cn('relative overflow-hidden rounded-[var(--ph-card-r)] border border-[color:var(--ph-border)] bg-[#eef1ec]', className)}
      style={{ height: h }}
      aria-label="Map preview"
    >
      <svg viewBox={`0 0 300 ${h}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden>
        <rect x="200" y={h * 0.08} width="80" height={h * 0.3} rx="6" fill="#d9e8d2" />
        <rect x="18" y={h * 0.62} width="70" height={h * 0.28} rx="6" fill="#d9e8d2" />
        <path d={`M0 ${h * 0.3} L300 ${h * 0.22}`} stroke="#fff" strokeWidth="10" />
        <path d={`M0 ${h * 0.78} L300 ${h * 0.7}`} stroke="#fff" strokeWidth="8" />
        <path d={`M95 0 L120 ${h}`} stroke="#fff" strokeWidth="9" />
        <path d={`M215 0 L190 ${h}`} stroke="#fff" strokeWidth="6" />
        <path d={`M0 ${h * 0.3} L300 ${h * 0.22}`} stroke="#f6d77b" strokeWidth="3" />
        {fence ? <circle cx="150" cy={cy} r={r} fill="var(--pp)" fillOpacity="0.1" stroke="var(--pp)" strokeWidth="2" strokeDasharray="6 4" /> : null}
        {agent ? (
          <g transform={`translate(${agent === 'inside' ? 172 : 150 + r + 26} ${agent === 'inside' ? cy + 16 : cy - 8})`}>
            <circle r="14" fill={FESS.info} fillOpacity="0.18" />
            <circle r="6" fill={FESS.info} stroke={FESS.page.background} strokeWidth="2.5" />
          </g>
        ) : null}
      </svg>
      {/* The job's pin in the accent, as the module draws it. */}
      <MapPin className="absolute left-1/2 size-8 -translate-x-1/2 -translate-y-full" style={{ top: cy + 2, fill: 'var(--pp)', color: FESS.page.background }} />
    </div>
  );
}

export function PhotoPlaceholder({ size = 64, label }: { size?: number; label?: string }) {
  return (
    <span
      className="flex shrink-0 flex-col items-center justify-center rounded-[var(--ph-inner-r)] bg-[color:var(--ph-subtle)] text-[color:var(--ph-muted)]"
      style={{ width: size, height: size * 1.2 }}
      aria-label={label ?? 'Photo'}
    >
      <User className="size-1/2" />
    </span>
  );
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A deterministic QR-like pattern, black on white as the module draws codes. The real code always comes from the server (docs/07 §10). */
export function QrPlaceholder({ size = 112, seed = 'fess-pos' }: { size?: number; seed?: string }) {
  const n = 21;
  const ink = FESS.text;
  const paper = FESS.page.background;
  let x = hashString(seed) || 1;
  const cells: { r: number; c: number }[] = [];
  const finder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      if (!finder(r, c) && (x >>> 0) % 2 === 0) cells.push({ r, c });
    }
  }
  const eye = (r: number, c: number) => (
    <g key={`${r}-${c}`}>
      <rect x={c} y={r} width="7" height="7" fill={ink} />
      <rect x={c + 1} y={r + 1} width="5" height="5" fill={paper} />
      <rect x={c + 2} y={r + 2} width="3" height="3" fill={ink} />
    </g>
  );
  return (
    <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} width={size} height={size} style={{ backgroundColor: paper }} aria-label="Verification QR code (placeholder)">
      {cells.map(({ r, c }) => (
        <rect key={`${r}.${c}`} x={c} y={r} width="1" height="1" fill={ink} />
      ))}
      {eye(0, 0)}
      {eye(0, n - 7)}
      {eye(n - 7, 0)}
    </svg>
  );
}
