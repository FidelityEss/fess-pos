'use client';

// Phone-styled building blocks for the definition preview (T3-23). They approximate the module's Material-like look
// (docs/11): 15 px body text, 44 px tap targets. Sizes are phone pixels on purpose — everything here renders inside
// <PhoneFrame>, which does not follow the admin text-size setting.
import { Check, ChevronDown, CircleAlert, Info, MapPin, OctagonAlert, TriangleAlert, User } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ChoiceOption {
  value: string;
  label: string;
  help_text?: string;
}

// ── Notices and placeholders ──────────────────────────────────────────────────────────────────────

/** A gentle in-phone note about something the preview cannot show (never an error screen). */
export function PreviewNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border border-dashed border-slate-300 bg-white/80 px-3 py-2 text-[13px] leading-snug text-slate-500', className)}>
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
        'rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-[13px] text-slate-500',
        highlighted && 'ring-2 ring-[var(--pp)] ring-offset-2',
      )}
    >
      <span className="font-mono">{type}</span> — preview not available yet
    </div>
  );
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_BOX: Record<Tone, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-800',
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-900',
};

export function toTone(v: unknown, fallback: Tone = 'info'): Tone {
  return v === 'neutral' || v === 'info' || v === 'success' || v === 'warning' || v === 'danger' ? v : fallback;
}

export function Callout({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  const Icon = tone === 'danger' ? OctagonAlert : tone === 'warning' ? TriangleAlert : Info;
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[14px] leading-snug', TONE_BOX[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export type RiskLevel = 'info' | 'elevated' | 'high';

export function RiskChip({ level, label }: { level: RiskLevel; label?: string }) {
  const tones: Record<RiskLevel, string> = {
    info: 'bg-sky-50 text-sky-800 border-sky-200',
    elevated: 'bg-amber-50 text-amber-900 border-amber-200',
    high: 'bg-red-50 text-red-800 border-red-200',
  };
  const names: Record<RiskLevel, string> = { info: 'Note', elevated: 'Elevated risk', high: 'High risk' };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-semibold', tones[level])}>
      <TriangleAlert className="size-3" />
      {label ? `${names[level]} · ${label}` : names[level]}
    </span>
  );
}

// ── Field shell ───────────────────────────────────────────────────────────────────────────────────

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
      className={cn('scroll-mt-6 rounded-xl p-1 transition-shadow', highlighted && 'ring-2 ring-[var(--pp)] ring-offset-2 ring-offset-[#f4f5f7]', className)}
    >
      {label ? (
        <div className="mb-1.5 text-[15px] font-medium leading-snug text-slate-900">
          {label}
          {required ? (
            <span className="ml-0.5 text-red-600" title="Required">
              *
            </span>
          ) : null}
        </div>
      ) : null}
      {helpText ? <p className="-mt-0.5 mb-1.5 text-[13px] leading-snug text-slate-500">{helpText}</p> : null}
      {children}
      {risk ? (
        <div className="mt-1.5">
          <RiskChip level={risk.level} label={risk.label} />
        </div>
      ) : null}
      {errors && errors.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {errors.map((e) => (
            <li key={e} className="flex items-start gap-1 text-[13px] leading-snug text-red-700">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              {e}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ── Inputs ────────────────────────────────────────────────────────────────────────────────────────

const INPUT =
  'h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 ' +
  'focus:border-[var(--pp)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--pp)_25%,transparent)] disabled:bg-slate-100 disabled:text-slate-500';

export function PhoneInput({ className, ...props }: React.ComponentProps<'input'>) {
  return <input {...props} className={cn(INPUT, className)} />;
}

export function PhoneTextArea({ className, rows = 3, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea rows={rows} {...props} className={cn(INPUT, 'h-auto py-2 leading-snug', className)} />;
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
        className={cn(INPUT, 'appearance-none pr-9', value === null && 'text-slate-400')}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value} className="text-slate-900">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
    </div>
  );
}

function OptionText({ option }: { option: ChoiceOption }) {
  return (
    <span className="min-w-0 flex-1 py-1.5">
      <span className="block text-[15px] leading-snug text-slate-900">{option.label}</span>
      {option.help_text ? <span className="block text-[13px] leading-snug text-slate-500">{option.help_text}</span> : null}
    </span>
  );
}

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
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-1 text-left hover:bg-slate-100 disabled:opacity-60"
          >
            <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border-2', on ? 'border-[var(--pp)]' : 'border-slate-400')}>
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
    <span className={cn('flex size-5 shrink-0 items-center justify-center rounded border-2', on ? 'border-[var(--pp)] bg-[var(--pp)] text-white' : 'border-slate-400 bg-white')}>
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
        <button
          key={o.value}
          type="button"
          role="checkbox"
          aria-checked={values.includes(o.value)}
          disabled={disabled}
          onClick={() => onToggle(o.value)}
          className="flex min-h-11 w-full items-center gap-3 rounded-lg px-1 text-left hover:bg-slate-100 disabled:opacity-60"
        >
          <CheckBox on={values.includes(o.value)} />
          <OptionText option={o} />
        </button>
      ))}
    </div>
  );
}

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
              'inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-[14px]',
              on ? 'border-[var(--pp)] bg-[color-mix(in_srgb,var(--pp)_12%,white)] font-medium text-[var(--pp)]' : 'border-slate-300 bg-white text-slate-800',
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
    <div className="flex overflow-hidden rounded-lg border border-slate-300 bg-white">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-h-11 flex-1 px-2 text-[14px]',
            i > 0 && 'border-l border-slate-300',
            o.value === value ? 'bg-[var(--pp)] font-semibold text-white' : 'text-slate-800 hover:bg-slate-50',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-[15px] disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">{label}</span>
      <span className={cn('relative h-6 w-10 shrink-0 rounded-full transition-colors', checked ? 'bg-[var(--pp)]' : 'bg-slate-300')}>
        <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
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
      className="-mx-1 flex min-h-11 w-full items-start gap-3 rounded-lg px-1 py-1.5 text-left text-[15px] leading-snug hover:bg-slate-100 disabled:opacity-60"
    >
      <span className="mt-0.5">
        <CheckBox on={checked} />
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

export function PhoneActionButton({
  children,
  onClick,
  variant = 'primary',
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'outline' | 'text' | 'danger';
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    primary: 'bg-[var(--pp)] text-white',
    outline: 'border border-[var(--pp)] bg-white text-[var(--pp)]',
    text: 'text-[var(--pp)] hover:bg-[color-mix(in_srgb,var(--pp)_8%,white)]',
    danger: 'border border-red-300 bg-white text-red-700',
  } as const;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn('flex h-11 w-full items-center justify-center gap-1.5 rounded-lg px-3 text-[15px] font-semibold disabled:opacity-40', styles[variant], className)}
    >
      {children}
    </button>
  );
}

/** Bottom bar of Back / Next style actions. */
export function StickyFooter({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 gap-2 border-t border-slate-200 bg-white px-3 py-2">{children}</div>;
}

/** A modal sheet inside the phone (render it through PhoneFrame's `overlay`). */
export function PhoneDialog({ title, children, actions }: { title: ReactNode; children?: ReactNode; actions: ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex items-end bg-black/40 p-3">
      <div role="dialog" aria-label={typeof title === 'string' ? title : undefined} className="w-full rounded-2xl bg-white p-4 shadow-xl">
        <div className="text-[17px] font-semibold text-slate-900">{title}</div>
        {children ? <div className="mt-2 text-[15px] leading-snug text-slate-700">{children}</div> : null}
        <div className="mt-4 flex gap-2">{actions}</div>
      </div>
    </div>
  );
}

export function StepIndicator({ index, total, label }: { index: number; total: number; label?: string }) {
  return (
    <div className="shrink-0 border-b border-slate-200 bg-white px-3 pb-2 pt-2">
      <div className="flex items-center justify-between text-[12px] font-medium text-slate-500">
        <span>
          Step {index + 1} of {total}
        </span>
        {label ? <span className="truncate pl-2 text-slate-700">{label}</span> : null}
      </div>
      <div className="mt-1.5 flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn('h-1 flex-1 rounded-full', i <= index ? 'bg-[var(--pp)]' : 'bg-slate-200')} />
        ))}
      </div>
    </div>
  );
}

// ── Text ──────────────────────────────────────────────────────────────────────────────────────────

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(part)) return <code key={i} className="rounded bg-slate-100 px-1 font-mono text-[13px]">{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** A small Markdown subset (paragraphs, line breaks, bullet lists, headings, **bold**, *italic*, `code`). */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim() !== '');
  return (
    <div className={cn('space-y-2 text-[15px] leading-relaxed text-slate-800', className)}>
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
        if (heading) return <div key={i} className="text-[16px] font-semibold text-slate-900">{inline(heading[2] ?? '')}</div>;
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
    <div className={cn('relative overflow-hidden rounded-xl border border-slate-200 bg-[#eef1ec]', className)} style={{ height: h }} aria-label="Map preview">
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
            <circle r="14" fill="#2799ff" fillOpacity="0.18" />
            <circle r="6" fill="#2799ff" stroke="#fff" strokeWidth="2.5" />
          </g>
        ) : null}
      </svg>
      <MapPin className="absolute left-1/2 size-8 -translate-x-1/2 -translate-y-full fill-red-500 text-red-700" style={{ top: cy + 2 }} />
    </div>
  );
}

export function PhotoPlaceholder({ size = 64, label }: { size?: number; label?: string }) {
  return (
    <span
      className="flex shrink-0 flex-col items-center justify-center rounded-lg bg-gradient-to-br from-slate-200 to-slate-300 text-slate-500"
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

/** A deterministic QR-like pattern. The real code always comes from the server (docs/07 §10). */
export function QrPlaceholder({ size = 112, seed = 'fess-pos' }: { size?: number; seed?: string }) {
  const n = 21;
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
      <rect x={c} y={r} width="7" height="7" fill="#0f172a" />
      <rect x={c + 1} y={r + 1} width="5" height="5" fill="#fff" />
      <rect x={c + 2} y={r + 2} width="3" height="3" fill="#0f172a" />
    </g>
  );
  return (
    <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} width={size} height={size} className="rounded bg-white" aria-label="Verification QR code (placeholder)">
      {cells.map(({ r, c }) => (
        <rect key={`${r}.${c}`} x={c} y={r} width="1" height="1" fill="#0f172a" />
      ))}
      {eye(0, 0)}
      {eye(0, n - 7)}
      {eye(n - 7, 0)}
    </svg>
  );
}
