'use client';

// Form renderer for the phone preview (T3-23): draws sections and every input, display, computed and structural
// component of the catalogue (docs/11 §3–5) from the engine-resolved form, and writes answers back to the preview state.
import { Camera, ImageIcon, LocateFixed, MapPin, Minus, PenLine, Plus, Search, Star, Trash2, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { EngineJsonValue, FieldDef, ResolvedField } from '@/lib/engine';
import { cn, isPlainObject } from '@/lib/utils';
import type { AnswerMeta, FormPreviewState } from './form-state';
import {
  Callout,
  CheckList,
  CheckRow,
  ChipGroup,
  type ChoiceOption,
  FieldShell,
  Markdown,
  MockMap,
  PhoneActionButton,
  PhoneInput,
  PhoneSelect,
  PhoneTextArea,
  PreviewNotice,
  RadioList,
  type RiskLevel,
  Segmented,
  toTone,
  Toggle,
  UnknownElement,
} from './phone-widgets';
import { usePreviewEnv } from './preview-context';
import { addressLines, formatValue, humanise } from './preview-format';

type Value = EngineJsonValue | undefined;

interface ControlProps {
  def: FieldDef;
  rf: ResolvedField;
  value: Value;
  onChange: (v: Value) => void;
  meta: AnswerMeta;
  onMeta: (patch: Partial<AnswerMeta>) => void;
  /** Rule data for templates (answers + context). */
  data: unknown;
  disabled: boolean;
  state: FormPreviewState;
}

/** A stand-in evidence id (the phone uses the id of the captured, hashed file). */
export function previewUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strProp = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asString = (v: Value): string => (typeof v === 'string' ? v : '');
const asStrings = (v: Value): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

// ── Choices ───────────────────────────────────────────────────────────────────────────────────────

function choiceOptions(def: FieldDef, rf: ResolvedField): { options: ChoiceOption[]; sampleFrom: string | null } {
  let options: ChoiceOption[] = (rf.options ?? []).map((o) => ({ value: o.value, label: o.label, ...(o.help_text ? { help_text: o.help_text } : {}) }));
  let sampleFrom: string | null = null;
  const src = def.options_source;
  if (options.length === 0 && (src || def.type === 'lookup')) {
    sampleFrom =
      src?.type === 'reason_codes' ? `reason codes “${src.category}”` : src?.type === 'lookup_list' ? `lookup list “${src.key}”` : `lookup list “${String(rf.props.list ?? '')}”`;
    options = [1, 2, 3].map((i) => ({ value: `sample_${i}`, label: `Sample option ${i}` }));
  }
  if (rf.props.allow_other === true) {
    const ov = strProp(rf.props.other_value) ?? 'other';
    if (!options.some((o) => o.value === ov)) options.push({ value: ov, label: strProp(rf.props.other_label) ?? 'Other' });
  }
  return { options, sampleFrom };
}

function OtherText({ rf, chosen, meta, onMeta, disabled }: { rf: ResolvedField; chosen: boolean; meta: AnswerMeta; onMeta: ControlProps['onMeta']; disabled: boolean }) {
  if (rf.props.allow_other !== true || !chosen) return null;
  return (
    <PhoneInput
      className="mt-2"
      placeholder="Describe"
      value={meta.other_text ?? ''}
      disabled={disabled}
      onChange={(e) => onMeta({ other_text: e.target.value })}
    />
  );
}

function SingleSelect({ def, rf, value, onChange, meta, onMeta, disabled }: ControlProps) {
  const { options, sampleFrom } = choiceOptions(def, rf);
  const [query, setQuery] = useState('');
  const v = typeof value === 'string' ? value : null;
  const ov = strProp(rf.props.other_value) ?? 'other';
  const set = (next: string | null) => {
    onChange(next ?? undefined);
    if (next !== ov && meta.other_text !== undefined) onMeta({ other_text: undefined });
  };
  const display = def.type === 'lookup' ? 'searchable_list' : (def.display ?? 'radio');
  let control: ReactNode;
  if (display === 'dropdown') control = <PhoneSelect options={options} value={v} onChange={set} disabled={disabled} />;
  else if (display === 'chips') control = <ChipGroup options={options} selected={v ? [v] : []} onToggle={(x) => set(x === v ? null : x)} disabled={disabled} />;
  else if (display === 'segmented') control = <Segmented options={options} value={v} onChange={set} disabled={disabled} />;
  else if (display === 'searchable_list' || display === 'searchable_sheet') {
    const q = query.trim().toLowerCase();
    const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q)).slice(0, 8);
    control = (
      <div className="rounded-lg border border-slate-200 bg-white p-2">
        <div className="relative mb-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <PhoneInput className="pl-9" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} disabled={disabled} />
        </div>
        <RadioList options={shown} value={v} onChange={set} disabled={disabled} />
        {shown.length === 0 ? <p className="px-1 py-2 text-[13px] text-slate-500">No matches</p> : null}
      </div>
    );
  } else control = <RadioList options={options} value={v} onChange={set} disabled={disabled} />;
  return (
    <>
      {sampleFrom ? <PreviewNotice className="mb-2">Options come from {sampleFrom} — sample options shown.</PreviewNotice> : null}
      {control}
      <OtherText rf={rf} chosen={v === ov} meta={meta} onMeta={onMeta} disabled={disabled} />
    </>
  );
}

function MultiSelect({ def, rf, value, onChange, meta, onMeta, disabled }: ControlProps) {
  const { options, sampleFrom } = choiceOptions(def, rf);
  const selected = asStrings(value);
  const exclusive = Array.isArray(rf.props.exclusive_options) ? (rf.props.exclusive_options as string[]) : [];
  const ov = strProp(rf.props.other_value) ?? 'other';
  const toggle = (x: string) => {
    let next = selected.includes(x) ? selected.filter((s) => s !== x) : exclusive.includes(x) ? [x] : [...selected.filter((s) => !exclusive.includes(s)), x];
    next = options.map((o) => o.value).filter((o) => next.includes(o));
    onChange(next.length ? next : undefined);
    if (!next.includes(ov) && meta.other_text !== undefined) onMeta({ other_text: undefined });
  };
  return (
    <>
      {sampleFrom ? <PreviewNotice className="mb-2">Options come from {sampleFrom} — sample options shown.</PreviewNotice> : null}
      {def.display === 'chips' ? (
        <ChipGroup options={options} selected={selected} onToggle={toggle} disabled={disabled} />
      ) : (
        <CheckList options={options} values={selected} onToggle={toggle} disabled={disabled} />
      )}
      <OtherText rf={rf} chosen={selected.includes(ov)} meta={meta} onMeta={onMeta} disabled={disabled} />
    </>
  );
}

function BooleanControl({ def, rf, value, onChange, disabled }: ControlProps) {
  const yes = strProp(rf.props.true_label) ?? 'Yes';
  const no = strProp(rf.props.false_label) ?? 'No';
  const v = typeof value === 'boolean' ? value : null;
  if (def.display === 'toggle') return <Toggle checked={v === true} onChange={(c) => onChange(c)} label={v === null ? 'Not answered' : v ? yes : no} disabled={disabled} />;
  if (def.display === 'checkbox') return <CheckRow checked={v === true} onChange={(c) => onChange(c)} disabled={disabled}>{rf.label || yes}</CheckRow>;
  return (
    <div className="grid grid-cols-2 gap-x-2">
      <RadioList options={[{ value: 'true', label: yes }]} value={v === true ? 'true' : null} onChange={() => onChange(true)} disabled={disabled} />
      <RadioList options={[{ value: 'false', label: no }]} value={v === false ? 'false' : null} onChange={() => onChange(false)} disabled={disabled} />
    </div>
  );
}

function TriState({ def, rf, value, onChange, disabled }: ControlProps) {
  const labels = isPlainObject(rf.props.labels) ? rf.props.labels : {};
  const options: ChoiceOption[] = [
    { value: 'yes', label: strProp(labels.yes) ?? 'Yes' },
    { value: 'no', label: strProp(labels.no) ?? 'No' },
    { value: 'na', label: strProp(labels.na) ?? 'N/A' },
  ];
  const v = typeof value === 'string' ? value : null;
  return def.display === 'radio' ? <RadioList options={options} value={v} onChange={onChange} disabled={disabled} /> : <Segmented options={options} value={v} onChange={onChange} disabled={disabled} />;
}

// ── Text & numbers ────────────────────────────────────────────────────────────────────────────────

function TextControl({ def, rf, value, onChange, disabled }: ControlProps) {
  const placeholder = strProp(rf.props.placeholder);
  const max = num(rf.props.max_length) ?? undefined;
  const inputMode = ({ number: 'numeric', phone: 'tel', email: 'email', url: 'url' } as const)[strProp(rf.props.keyboard) as 'number'] ?? undefined;
  if (def.type === 'textarea') {
    return <PhoneTextArea rows={num(rf.props.rows) ?? 3} placeholder={placeholder} maxLength={max} value={asString(value)} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)} />;
  }
  const hint = def.type === 'id_number' ? 'e.g. 8001015009087' : def.type === 'registration_number' ? 'e.g. 2015/123456/07' : def.type === 'email' ? 'name@example.co.za' : undefined;
  return (
    <PhoneInput
      type={def.type === 'email' ? 'email' : 'text'}
      inputMode={inputMode}
      placeholder={placeholder ?? hint}
      maxLength={max}
      autoCapitalize={rf.props.capitalise === 'words' ? 'words' : undefined}
      value={asString(value)}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}

function NumberInput({ value, onChange, disabled, suffix, prefix, placeholder, step }: { value: number | null; onChange: (n: number | undefined) => void; disabled: boolean; suffix?: string; prefix?: string; placeholder?: string; step?: number }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const shown = value === null ? (text === '' || Number.isNaN(Number(text)) ? text : '') : Number(text) === value ? text : String(value);
  return (
    <div className="relative">
      {prefix ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-slate-500">{prefix}</span> : null}
      <PhoneInput
        inputMode="decimal"
        placeholder={placeholder}
        className={cn(prefix && 'pl-8', suffix && 'pr-12')}
        value={shown}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const t = e.target.value.replace(',', '.');
          setText(t);
          const n = Number(t);
          onChange(t.trim() === '' || Number.isNaN(n) ? undefined : n);
        }}
      />
      {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[15px] text-slate-500">{suffix}</span> : null}
    </div>
  );
}

function NumberControl({ def, rf, value, onChange, disabled }: ControlProps) {
  const v = num(value);
  const min = num(rf.props.min);
  const max = num(rf.props.max);
  if (def.type === 'percentage' && def.display === 'slider') {
    return <RangeControl value={v} min={min ?? 0} max={max ?? 100} step={1} onChange={onChange} disabled={disabled} suffix="%" />;
  }
  if (def.type === 'number' && def.display === 'stepper') {
    const step = num(rf.props.step) ?? 1;
    const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    return (
      <div className="flex items-center gap-3">
        <PhoneActionButton variant="outline" className="w-11" disabled={disabled} onClick={() => onChange(clamp((v ?? min ?? 0) - step))}>
          <Minus className="size-4" />
        </PhoneActionButton>
        <span className="min-w-12 text-center text-[18px] font-semibold">{v ?? '—'}</span>
        <PhoneActionButton variant="outline" className="w-11" disabled={disabled} onClick={() => onChange(clamp((v ?? min ?? 0) + step))}>
          <Plus className="size-4" />
        </PhoneActionButton>
        {strProp(rf.props.unit) ? <span className="text-[15px] text-slate-500">{strProp(rf.props.unit)}</span> : null}
      </div>
    );
  }
  const hint = min !== null && max !== null ? `${min}–${max}` : min !== null ? `${min} or more` : max !== null ? `up to ${max}` : undefined;
  return <NumberInput value={v} onChange={onChange} disabled={disabled} suffix={def.type === 'percentage' ? '%' : strProp(rf.props.unit)} placeholder={strProp(rf.props.placeholder) ?? hint} />;
}

function RangeControl({ value, min, max, step, onChange, disabled, suffix, minLabel, maxLabel }: { value: number | null; min: number; max: number; step: number; onChange: (v: Value) => void; disabled: boolean; suffix?: string; minLabel?: string; maxLabel?: string }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value ?? min}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-11 flex-1 accent-[var(--pp)]"
          aria-label="Value"
        />
        <span className="w-14 text-right text-[15px] font-semibold">{value === null ? '—' : `${value}${suffix ?? ''}`}</span>
      </div>
      {minLabel || maxLabel ? (
        <div className="flex justify-between text-[12px] text-slate-500">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

function PhoneControl({ rf, value, onChange, disabled }: ControlProps) {
  const region = strProp(rf.props.default_region) ?? 'ZA';
  const prefix = region === 'ZA' ? '+27' : null;
  const v = asString(value);
  const local = prefix && v.startsWith(prefix) ? v.slice(prefix.length) : v;
  return (
    <div className="flex gap-2">
      {prefix ? <span className="flex h-11 shrink-0 items-center rounded-lg border border-slate-300 bg-slate-50 px-3 text-[15px] text-slate-700">🇿🇦 {prefix}</span> : null}
      <PhoneInput
        inputMode="tel"
        placeholder={prefix ? '82 123 4567' : '+27821234567'}
        value={local}
        disabled={disabled}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^\d+]/g, '');
          if (!digits) return onChange(undefined);
          onChange(prefix && !digits.startsWith('+') ? `${prefix}${digits.replace(/^0/, '')}` : digits);
        }}
      />
    </div>
  );
}

function RatingControl({ def, rf, value, onChange, disabled }: ControlProps) {
  const scale = num(rf.props.scale) ?? 5;
  const labels = Array.isArray(rf.props.labels) ? (rf.props.labels as string[]) : [];
  const v = num(value);
  if (def.display === 'likert' || def.display === 'numbered') {
    const options = Array.from({ length: scale }, (_, i) => ({ value: String(i + 1), label: def.display === 'likert' ? (labels[i] ?? String(i + 1)) : String(i + 1) }));
    return def.display === 'likert' ? (
      <RadioList options={options} value={v === null ? null : String(v)} onChange={(x) => onChange(Number(x))} disabled={disabled} />
    ) : (
      <Segmented options={options} value={v === null ? null : String(v)} onChange={(x) => onChange(Number(x))} disabled={disabled} />
    );
  }
  return (
    <div className="flex gap-1">
      {Array.from({ length: scale }, (_, i) => (
        <button key={i} type="button" disabled={disabled} aria-label={`${i + 1} of ${scale}`} onClick={() => onChange(i + 1)} className="p-1">
          <Star className={cn('size-7', v !== null && i < v ? 'fill-amber-400 text-amber-500' : 'text-slate-300')} />
        </button>
      ))}
    </div>
  );
}

function CurrencyControl({ rf, value, onChange, disabled }: ControlProps) {
  const cur = strProp(rf.props.currency) ?? 'ZAR';
  const minor = isPlainObject(value) ? num(value.minor) : null;
  return (
    <NumberInput
      prefix={cur === 'ZAR' ? 'R' : cur}
      value={minor === null ? null : minor / 100}
      disabled={disabled}
      placeholder="0.00"
      onChange={(n) => onChange(n === undefined ? undefined : { minor: Math.round(n * 100), currency: cur })}
    />
  );
}

// ── Dates ─────────────────────────────────────────────────────────────────────────────────────────

function DateControl({ def, rf, value, onChange, meta, onMeta, disabled }: ControlProps) {
  const type = def.type === 'time' ? 'time' : def.type === 'datetime' ? 'datetime-local' : 'date';
  const toLocal = (v: string) => {
    if (type !== 'datetime-local') return v;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const unknown = meta.unknown === true;
  return (
    <>
      <PhoneInput
        type={type}
        value={unknown ? '' : toLocal(asString(value))}
        min={type === 'date' ? strProp(rf.props.min)?.slice(0, 10) : strProp(rf.props.min)}
        max={type === 'date' ? strProp(rf.props.max)?.slice(0, 10) : strProp(rf.props.max)}
        disabled={disabled || unknown}
        onChange={(e) => {
          const t = e.target.value;
          if (!t) return onChange(undefined);
          onChange(type === 'datetime-local' ? new Date(t).toISOString() : t);
        }}
      />
      {def.type === 'date' && rf.props.allow_unknown === true ? (
        <CheckRow
          checked={unknown}
          disabled={disabled}
          onChange={(c) => {
            onMeta({ unknown: c || undefined });
            if (c) onChange(undefined);
          }}
        >
          I don’t know
        </CheckRow>
      ) : null}
    </>
  );
}

function DurationControl({ rf, value, onChange, disabled }: ControlProps) {
  const units = Array.isArray(rf.props.units) && rf.props.units.length ? (rf.props.units as string[]) : ['days', 'months', 'years'];
  const cur = isPlainObject(value) ? value : null;
  const n = cur ? num(cur.value) : null;
  const unit = cur && typeof cur.unit === 'string' ? cur.unit : (units[units.length - 1] ?? 'years');
  return (
    <div className="flex gap-2">
      <div className="w-28">
        <NumberInput value={n} disabled={disabled} placeholder="0" onChange={(x) => onChange(x === undefined ? undefined : { value: Math.max(0, Math.round(x)), unit })} />
      </div>
      <PhoneSelect
        className="flex-1"
        options={units.map((u) => ({ value: u, label: humanise(u) }))}
        value={unit}
        disabled={disabled}
        onChange={(u) => onChange(n === null ? undefined : { value: n, unit: u ?? unit })}
      />
    </div>
  );
}

const HOUR_GROUP_LABEL: Record<string, string> = { weekdays: 'Mon–Fri', saturday: 'Saturday', sunday: 'Sunday', public_holidays: 'Public holidays' };
const HOUR_DEFAULTS: Record<string, EngineJsonValue> = { weekdays: { open: '08:00', close: '17:00' }, saturday: { open: '08:00', close: '13:00' }, sunday: 'closed', public_holidays: 'closed' };

function BusinessHoursControl({ rf, value, onChange, disabled }: ControlProps) {
  const groups = Array.isArray(rf.props.groups) && rf.props.groups.length ? (rf.props.groups as string[]) : ['weekdays', 'saturday', 'sunday', 'public_holidays'];
  const cur = isPlainObject(value) ? (value as Record<string, EngineJsonValue>) : null;
  const full = (): Record<string, EngineJsonValue> => Object.fromEntries(groups.map((g) => [g, cur?.[g] ?? HOUR_DEFAULTS[g] ?? 'closed']));
  const set = (g: string, h: EngineJsonValue) => onChange({ ...full(), [g]: h });
  return (
    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {!cur ? <p className="px-3 pt-2 text-[13px] text-slate-500">Tap a day to set the hours.</p> : null}
      {groups.map((g) => {
        const h = cur?.[g];
        const open = cur ? h !== 'closed' : false;
        const times = isPlainObject(h) ? h : null;
        return (
          <div key={g} className="px-3 py-1.5">
            <Toggle
              checked={open}
              disabled={disabled}
              label={
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{HOUR_GROUP_LABEL[g] ?? humanise(g)}</span>
                  <span className="text-[13px] text-slate-500">{!cur ? 'Not set' : h === 'closed' ? 'Closed' : h === '24h' ? 'Open 24 hours' : 'Open'}</span>
                </span>
              }
              onChange={(c) => set(g, c ? (isPlainObject(HOUR_DEFAULTS[g]) ? HOUR_DEFAULTS[g] : { open: '08:00', close: '17:00' }) : 'closed')}
            />
            {times ? (
              <div className="flex items-center gap-2 pb-1">
                <PhoneInput type="time" value={asString(times.open as Value)} disabled={disabled} onChange={(e) => set(g, { open: e.target.value, close: asString(times.close as Value) })} />
                <span className="text-slate-500">to</span>
                <PhoneInput type="time" value={asString(times.close as Value)} disabled={disabled} onChange={(e) => set(g, { open: asString(times.open as Value), close: e.target.value })} />
              </div>
            ) : null}
            {open && rf.props.allow_24h === true ? (
              <CheckRow checked={h === '24h'} disabled={disabled} onChange={(c) => set(g, c ? '24h' : { open: '08:00', close: '17:00' })}>
                Open 24 hours
              </CheckRow>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ── Location ──────────────────────────────────────────────────────────────────────────────────────

function AddressControl({ rf, value, onChange, disabled }: ControlProps) {
  const env = usePreviewEnv();
  const cur = isPlainObject(value) ? (value as Record<string, EngineJsonValue>) : {};
  const set = (k: string, v: string) => {
    const next: Record<string, EngineJsonValue> = { ...cur };
    if (v) next[k] = v;
    else delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  const provinces = Array.isArray(rf.props.provinces) ? (rf.props.provinces as string[]) : null;
  const pinMode = strProp(rf.props.map_pin) ?? 'optional';
  const text = (k: string, placeholder: string) => <PhoneInput placeholder={placeholder} value={asString(cur[k] as Value)} disabled={disabled} onChange={(e) => set(k, e.target.value)} />;
  return (
    <div className="grid gap-2">
      {text('line1', 'Street address')}
      {text('suburb', 'Suburb')}
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        {text('city', 'City / town')}
        {text('postal_code', 'Postal code')}
      </div>
      {provinces ? (
        <PhoneSelect options={provinces.map((p) => ({ value: p, label: p }))} value={typeof cur.province === 'string' ? cur.province : null} placeholder="Province" disabled={disabled} onChange={(p) => set('province', p ?? '')} />
      ) : (
        text('province', 'Province')
      )}
      {pinMode !== 'none' ? (
        <>
          <MockMap height={120} />
          <PhoneActionButton
            variant="outline"
            disabled={disabled}
            onClick={() => {
              const loc = env.context.job.location;
              onChange({ ...cur, pin: { lat: loc.lat, lng: loc.lng, source: 'map_pin' } });
            }}
          >
            <MapPin className="size-4" /> {cur.pin ? 'Pin dropped' : `Drop a pin${pinMode === 'required' ? ' (required)' : ''}`}
          </PhoneActionButton>
        </>
      ) : null}
    </div>
  );
}

function LocationControl({ def, rf, value, onChange, disabled }: ControlProps) {
  const env = usePreviewEnv();
  const loc = env.context.job.location;
  const set = isPlainObject(value);
  if (def.type === 'current_location') {
    const maxAcc = num(rf.props.max_accuracy_m);
    return (
      <div className="grid gap-2">
        <PhoneActionButton
          variant="outline"
          disabled={disabled}
          onClick={() => onChange({ lat: loc.lat + 0.0001, lng: loc.lng + 0.0001, accuracy_m: 8, ts: new Date().toISOString(), is_mocked: false })}
        >
          <LocateFixed className="size-4" /> {set ? 'Location recorded · ±8 m' : 'Get my location'}
        </PhoneActionButton>
        {maxAcc !== null ? <p className="text-[13px] text-slate-500">Needs accuracy of {maxAcc} m or better.</p> : null}
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <MockMap height={140} agent={set ? 'inside' : null} />
      <PhoneActionButton
        variant="outline"
        disabled={disabled}
        onClick={() => onChange({ lat: loc.lat, lng: loc.lng, source: rf.props.initial === 'current' ? 'current_location' : 'job' })}
      >
        <MapPin className="size-4" /> {set ? 'Pin placed' : 'Place pin here'}
      </PhoneActionButton>
    </div>
  );
}

// ── Evidence ──────────────────────────────────────────────────────────────────────────────────────

function PhotoControl({ def, rf, value, onChange, disabled }: ControlProps) {
  const ids = asStrings(value);
  const min = num(rf.props.min_count) ?? 0;
  const max = num(rf.props.max_count);
  const guidance = isPlainObject(rf.props.guidance) ? strProp(rf.props.guidance.text) : undefined;
  const range = max !== null ? (min === max ? `${min}` : `${min}–${max}`) : `at least ${min}`;
  const canAdd = max === null || ids.length < max;
  return (
    <div>
      <p className="mb-2 text-[13px] text-slate-600">
        Take {range} photo{max === 1 ? '' : 's'} with the camera
        {rf.props.require_gps === true ? ' · location recorded' : ''}
        {min > 0 ? <span className="font-medium"> · {Math.min(ids.length, min)}/{min} done</span> : null}
      </p>
      {guidance ? <Callout tone="info" className="mb-2">{guidance}</Callout> : null}
      <div className={cn('grid gap-2', def.display === 'guided_sequence' ? 'grid-cols-2' : 'grid-cols-3')}>
        {ids.map((id, i) => (
          <div key={id} className="relative aspect-square overflow-hidden rounded-lg bg-gradient-to-br from-emerald-100 via-slate-200 to-sky-200">
            <ImageIcon className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-slate-500" />
            <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1 text-[11px] text-white">{i + 1}</span>
            {!disabled ? (
              <button type="button" aria-label="Remove photo" onClick={() => onChange(ids.length > 1 ? ids.filter((x) => x !== id) : undefined)} className="absolute right-1 top-1 rounded-full bg-black/55 p-0.5 text-white">
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        ))}
        {canAdd ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange([...ids, previewUuid()])}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-[color-mix(in_srgb,var(--pp)_45%,white)] bg-white text-[13px] font-medium text-[var(--pp)]"
          >
            <Camera className="size-6" />
            Take photo
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SignatureControl({ rf, value, onChange, disabled, state }: ControlProps) {
  const nameKey = strProp(rf.props.signer_name_field);
  const roleKey = strProp(rf.props.signer_designation_field);
  const name = nameKey ? asString(state.answers[nameKey]) : '';
  const role = roleKey ? asString(state.answers[roleKey]) : '';
  const signed = typeof value === 'string';
  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(signed ? undefined : previewUuid())}
        className="relative flex h-32 w-full items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white text-[14px] text-slate-500"
      >
        {signed ? (
          <svg viewBox="0 0 200 60" className="h-20 w-4/5" aria-label="Signature">
            <path d="M5 42 C 20 10, 30 55, 45 30 S 70 5, 80 35 S 100 55, 115 25 S 140 10, 150 38 S 175 45, 195 20" fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        ) : (
          <span className="flex items-center gap-1.5">
            <PenLine className="size-4" /> Tap to sign
          </span>
        )}
        <span className="absolute bottom-2 left-3 right-3 border-t border-slate-300" />
      </button>
      <div className="mt-1 flex items-center justify-between text-[13px] text-slate-600">
        <span>{name || role ? [name, role].filter(Boolean).join(' · ') : 'Signer name appears here'}</span>
        {signed && !disabled ? (
          <button type="button" onClick={() => onChange(undefined)} className="font-medium text-[var(--pp)]">
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── Legal ─────────────────────────────────────────────────────────────────────────────────────────

export function DeclarationText({ declarationKey }: { declarationKey: string | undefined }) {
  const env = usePreviewEnv();
  const decl = declarationKey ? env.declarations[declarationKey] : undefined;
  if (!decl) {
    return <PreviewNotice>The text of declaration “{declarationKey ?? '—'}” comes from the declarations register and is not loaded in this preview.</PreviewNotice>;
  }
  return (
    <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="mb-1 text-[15px] font-semibold">{decl.title}</div>
      <p className="whitespace-pre-line text-[14px] leading-relaxed text-slate-700">{decl.text}</p>
    </div>
  );
}

function DeclarationControl({ rf, value, onChange, disabled }: ControlProps) {
  const accepted = isPlainObject(value) && value.accepted === true;
  return (
    <div className="grid gap-2">
      <DeclarationText declarationKey={strProp(rf.props.declaration_key)} />
      <CheckRow
        checked={accepted}
        disabled={disabled}
        onChange={(c) => onChange(c ? { accepted: true, declaration_version_id: previewUuid(), accepted_at: new Date().toISOString() } : undefined)}
      >
        I have read and accept this declaration
      </CheckRow>
    </div>
  );
}

function ConsentControl({ rf, value, onChange, disabled, state }: ControlProps) {
  const byKey = strProp(rf.props.by_name_field);
  const byName = byKey ? asString(state.answers[byKey]) : '';
  const given = isPlainObject(value) ? value.given === true : null;
  const set = (g: boolean) => onChange({ given: g, text_version_id: previewUuid(), at: new Date().toISOString(), by_name: byName || 'Interviewee' });
  return (
    <div className="grid gap-2">
      <DeclarationText declarationKey={strProp(rf.props.declaration_key)} />
      <p className="text-[13px] text-slate-600">Given by: {byName || <span className="italic">name entered above</span>}</p>
      <Segmented
        options={[
          { value: 'yes', label: 'Agrees' },
          { value: 'no', label: 'Does not agree' },
        ]}
        value={given === null ? null : given ? 'yes' : 'no'}
        onChange={(x) => set(x === 'yes')}
        disabled={disabled}
      />
    </div>
  );
}

// ── Display, computed, structural ────────────────────────────────────────────────────────────────

function PrefilledControl({ rf, meta, onMeta, disabled }: ControlProps) {
  const lines = isPlainObject(rf.value) && ('line1' in rf.value || 'city' in rf.value) ? addressLines(rf.value) : null;
  return (
    <div className="grid gap-1.5">
      <div className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2.5 text-[15px] text-slate-800">
        {rf.value === null ? <span className="text-slate-500">No value on this job ({strProp(rf.props.source)})</span> : lines ? lines.map((l) => <div key={l}>{l}</div>) : formatValue(rf.value)}
      </div>
      {rf.props.allow_flag_differs === true ? (
        <>
          <Toggle checked={meta.flagged_differs === true} onChange={(c) => onMeta({ flagged_differs: c || undefined })} label="This is different at the premises" disabled={disabled} />
          {meta.flagged_differs && strProp(rf.props.differs_note) ? <Callout tone="warning">{strProp(rf.props.differs_note)}</Callout> : null}
        </>
      ) : null}
    </div>
  );
}

function ComputedControl({ rf }: ControlProps) {
  const fmt = strProp(rf.props.format);
  const v = rf.value;
  const text = typeof v === 'number' && rf.props.decimals !== undefined ? v.toFixed(num(rf.props.decimals) ?? 0) : formatValue(v, fmt === 'text' ? null : fmt);
  return <div className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2.5 text-[15px] font-medium text-slate-800">{text}</div>;
}

function MatrixControl({ rf, value, onChange, disabled }: ControlProps) {
  const rows = Array.isArray(rf.props.rows) ? (rf.props.rows as { key: string; label: string }[]) : [];
  const cols = Array.isArray(rf.props.columns) ? (rf.props.columns as { value: string; label: string }[]) : [];
  const cell = strProp(rf.props.cell_type) ?? 'single';
  const cur = isPlainObject(value) ? (value as Record<string, EngineJsonValue>) : {};
  const set = (row: string, v: EngineJsonValue | undefined) => {
    const next = { ...cur };
    if (v === undefined || (Array.isArray(v) && v.length === 0) || v === '') delete next[row];
    else next[row] = v;
    onChange(Object.keys(next).length ? next : undefined);
  };
  const options = cols.map((c) => ({ value: c.value, label: c.label }));
  return (
    <div className="grid gap-2">
      {rows.map((r) => (
        <div key={r.key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="mb-1 text-[14px] font-medium">{r.label}</div>
          {cell === 'text' ? (
            <PhoneInput value={asString(cur[r.key] as Value)} disabled={disabled} onChange={(e) => set(r.key, e.target.value || undefined)} />
          ) : cell === 'multi' ? (
            <ChipGroup
              options={options}
              selected={asStrings(cur[r.key] as Value)}
              disabled={disabled}
              onToggle={(x) => {
                const s = asStrings(cur[r.key] as Value);
                set(r.key, s.includes(x) ? s.filter((y) => y !== x) : [...s, x]);
              }}
            />
          ) : (
            <ChipGroup options={options} selected={typeof cur[r.key] === 'string' ? [cur[r.key] as string] : []} disabled={disabled} onToggle={(x) => set(r.key, cur[r.key] === x ? undefined : x)} />
          )}
        </div>
      ))}
    </div>
  );
}

function RepeatableGroup({ def, rf, value, onChange, disabled, state }: ControlProps) {
  const items = Array.isArray(value) ? value.map((it) => (isPlainObject(it) ? (it as Record<string, EngineJsonValue>) : {})) : [];
  const min = num(rf.props.min_items);
  const max = num(rf.props.max_items);
  const setItem = (i: number, key: string, v: Value) => {
    const next = items.map((it, j) => {
      if (j !== i) return it;
      const copy = { ...it };
      if (v === undefined) delete copy[key];
      else copy[key] = v;
      return copy;
    });
    onChange(next);
  };
  return (
    <div className="grid gap-2">
      {items.map((it, i) => {
        const resolvedItem = rf.items?.[i];
        const label = strProp(rf.props.item_label);
        return (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[14px] font-semibold">{label ? label.replace(/\{\{\s*index\s*\}\}/g, String(i + 1)).replace(/\{\{[^}]*\}\}/g, '') || `Item ${i + 1}` : `Item ${i + 1}`}</span>
              {!disabled ? (
                <button type="button" aria-label="Remove item" onClick={() => onChange(items.length > 1 ? items.filter((_, j) => j !== i) : undefined)} className="rounded p-1 text-slate-500 hover:bg-slate-100">
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </div>
            <div className="grid gap-3">
              {(def.fields ?? []).map((child) => {
                const crf = resolvedItem?.fields[child.key];
                if (!crf || !crf.visible) return null;
                return (
                  <FieldView
                    key={child.key}
                    def={child}
                    rf={crf}
                    value={it[child.key]}
                    onChange={(v) => setItem(i, child.key, v)}
                    meta={{}}
                    onMeta={() => undefined}
                    data={resolvedItem?.data}
                    state={state}
                    errors={undefined}
                    risk={null}
                    highlighted={false}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
      {max === null || items.length < max ? (
        <PhoneActionButton variant="outline" disabled={disabled} onClick={() => onChange([...items, {}])}>
          <Plus className="size-4" /> {strProp(rf.props.add_label) ?? 'Add'}
        </PhoneActionButton>
      ) : null}
      {min !== null && min > 0 ? <p className="text-[13px] text-slate-500">Add at least {min}.</p> : null}
    </div>
  );
}

const DISPLAY_TYPES = new Set(['info', 'callout', 'divider', 'image']);

function Control(p: ControlProps): ReactNode {
  switch (p.def.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'id_number':
    case 'registration_number':
      return <TextControl {...p} />;
    case 'number':
    case 'percentage':
      return <NumberControl {...p} />;
    case 'slider':
      return (
        <RangeControl
          value={num(p.value)}
          min={num(p.rf.props.min) ?? 0}
          max={num(p.rf.props.max) ?? 10}
          step={num(p.rf.props.step) ?? 1}
          onChange={p.onChange}
          disabled={p.disabled}
          minLabel={strProp(p.rf.props.min_label)}
          maxLabel={strProp(p.rf.props.max_label)}
        />
      );
    case 'phone':
      return <PhoneControl {...p} />;
    case 'currency':
      return <CurrencyControl {...p} />;
    case 'rating':
      return <RatingControl {...p} />;
    case 'boolean':
      return <BooleanControl {...p} />;
    case 'tri_state':
      return <TriState {...p} />;
    case 'single_select':
    case 'lookup':
      return <SingleSelect {...p} />;
    case 'multi_select':
      return <MultiSelect {...p} />;
    case 'date':
    case 'time':
    case 'datetime':
      return <DateControl {...p} />;
    case 'duration':
      return <DurationControl {...p} />;
    case 'business_hours':
      return <BusinessHoursControl {...p} />;
    case 'address':
      return <AddressControl {...p} />;
    case 'location_pin':
    case 'current_location':
      return <LocationControl {...p} />;
    case 'photo':
      return <PhotoControl {...p} />;
    case 'signature':
      return <SignatureControl {...p} />;
    case 'declaration':
      return <DeclarationControl {...p} />;
    case 'acknowledgement':
      return (
        <CheckRow checked={p.value === true} disabled={p.disabled} onChange={(c) => p.onChange(c ? true : undefined)}>
          {strProp(p.rf.props.text) ?? 'I acknowledge'}
        </CheckRow>
      );
    case 'consent':
      return <ConsentControl {...p} />;
    case 'prefilled':
      return <PrefilledControl {...p} />;
    case 'computed':
      return <ComputedControl {...p} />;
    case 'matrix':
      return <MatrixControl {...p} />;
    case 'repeatable_group':
      return <RepeatableGroup {...p} />;
    default:
      return <UnknownElement type={p.def.type} />;
  }
}

export function FieldView({
  def,
  rf,
  value,
  onChange,
  meta,
  onMeta,
  data,
  state,
  errors,
  risk,
  highlighted,
}: Omit<ControlProps, 'disabled'> & { errors: readonly string[] | undefined; risk: { level: RiskLevel; label?: string } | null; highlighted: boolean }) {
  const env = usePreviewEnv();
  if (!rf.visible) return null;
  if (DISPLAY_TYPES.has(def.type)) {
    const cls = cn('scroll-mt-6 rounded-xl', highlighted && 'ring-2 ring-[var(--pp)] ring-offset-2 ring-offset-[#f4f5f7]');
    if (def.type === 'divider') return <hr data-preview-anchor={def.key} className={cn('my-1 border-slate-200', cls)} />;
    if (def.type === 'callout') {
      return (
        <div data-preview-anchor={def.key} className={cls}>
          <Callout tone={toTone(def.tone, 'info')}>
            <Markdown text={rf.text ?? ''} className="text-[14px]" />
          </Callout>
        </div>
      );
    }
    if (def.type === 'image') {
      return (
        <figure data-preview-anchor={def.key} className={cls}>
          <div className="flex h-32 items-center justify-center rounded-lg bg-slate-200 text-slate-500">
            <ImageIcon className="size-8" />
          </div>
          {rf.text ? <figcaption className="mt-1 text-[13px] text-slate-600">{rf.text}</figcaption> : null}
        </figure>
      );
    }
    return (
      <div data-preview-anchor={def.key} className={cls}>
        <Markdown text={rf.text ?? ''} />
      </div>
    );
  }
  if (def.type === 'group') {
    const two = rf.props.layout === 'two_column';
    return (
      <FieldShell anchor={def.key} label={rf.label} helpText={def.help_text} highlighted={highlighted}>
        <div className={cn('grid gap-3', two && 'grid-cols-2')}>
          {(def.fields ?? []).map((child) => (
            <FieldSlot key={child.key} def={child} state={state} />
          ))}
        </div>
      </FieldShell>
    );
  }
  if (def.type === 'computed' && rf.props.hidden === true) {
    return env.focus === def.key ? <PreviewNotice>“{def.key}” is computed and hidden on the phone (value: {formatValue(rf.value)}).</PreviewNotice> : null;
  }
  return (
    <FieldShell anchor={def.key} label={rf.label} required={rf.required} helpText={def.help_text} errors={errors} risk={risk} highlighted={highlighted}>
      <Control def={def} rf={rf} value={value} onChange={onChange} meta={meta} onMeta={onMeta} data={data} disabled={rf.read_only && def.type !== 'prefilled'} state={state} />
    </FieldShell>
  );
}

/** A top-level (or group child) field bound to the preview state. */
export function FieldSlot({ def, state }: { def: FieldDef; state: FormPreviewState }) {
  const env = usePreviewEnv();
  const rf = state.resolved?.fields[def.key];
  if (!rf) return <UnknownElement type={def.type} anchor={def.key} />;
  const value = rf.computed ? (rf.value ?? undefined) : state.answers[def.key];
  return (
    <FieldView
      def={def}
      rf={rf}
      value={value}
      onChange={(v) => state.setValue(def.key, v)}
      meta={state.meta[def.key] ?? {}}
      onMeta={(p) => state.setMeta(def.key, p)}
      data={state.resolved?.data}
      state={state}
      errors={state.errors[def.key]}
      risk={state.riskFor(def.key)}
      highlighted={env.focus === def.key}
    />
  );
}

/** The given sections of the form (all when omitted), as the phone lays them out. */
export function FormSections({ state, sectionKeys, showTitles = true }: { state: FormPreviewState; sectionKeys?: readonly string[]; showTitles?: boolean }) {
  const env = usePreviewEnv();
  const { form, resolved } = state;
  if (!form) return null;
  if (!resolved) {
    return (
      <div className="p-3">
        <PreviewNotice>This form can’t be evaluated yet: {state.resolveError ?? 'unknown problem'}.</PreviewNotice>
      </div>
    );
  }
  const keys = sectionKeys ?? form.sections.map((s) => s.key);
  const general = state.errors[''];
  return (
    <div className="space-y-5 px-3 py-3">
      {general ? <Callout tone="danger">{general.join(' ')}</Callout> : null}
      {keys.map((k) => {
        const section = form.sections.find((s) => s.key === k);
        if (!section) return <PreviewNotice key={k}>Section “{k}” is not in the form.</PreviewNotice>;
        const rs = resolved.sections[k];
        if (rs && !rs.visible) {
          return (
            <PreviewNotice key={k}>
              Section “{typeof section.title === 'string' ? section.title : k}” is hidden by its rule for this sample.
            </PreviewNotice>
          );
        }
        const empty = section.fields.length === 0;
        return (
          <section
            key={k}
            data-preview-anchor={k}
            className={cn('scroll-mt-4 rounded-xl', env.focus === k && 'ring-2 ring-[var(--pp)] ring-offset-4 ring-offset-[#f4f5f7]')}
          >
            {showTitles ? (
              <header className="mb-3">
                <h2 className="text-[18px] font-semibold leading-tight text-slate-900">{rs?.title ?? (typeof section.title === 'string' ? section.title : humanise(k))}</h2>
                {section.description ? <p className="mt-0.5 text-[14px] text-slate-600">{section.description}</p> : null}
              </header>
            ) : null}
            <div className="grid gap-4">
              {empty ? <PreviewNotice>No fields in this section yet.</PreviewNotice> : null}
              {section.fields.map((f) => (
                <FieldSlot key={f.key} def={f} state={state} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
