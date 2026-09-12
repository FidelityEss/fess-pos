'use client';

// The typed App settings editor: friendly sections of settings, one control per key type, nested location-type cards and
// feature toggles with add/remove, and — for every key — where its value comes from and whether this layer overrides it.
// Keys not shown (technical ones in Basic view, unknown keys) are never touched: edits change only their own path.
import { ChevronDown, Pencil, Plus, ShieldAlert, Trash2, Undo2, Wrench } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { humanLabel } from '@/components/structured-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { DEFAULT_GEOFENCE_PROFILES, PROFILE_BOUNDS } from '@/lib/engine';
import { usePreferences } from '@/lib/preferences';
import type { ConfigLayer, JsonObject } from '@/lib/types';
import { cn, isPlainObject } from '@/lib/utils';
import { CONFIG_KEY_RE, deleteIn, getPath, hasPath, jsonEqual, setIn, toSnakeKey } from './config-doc';
import {
  formatSettingValue,
  keysForSection,
  PROFILE_CHECKIN,
  PROFILE_FIELDS,
  profileLabel,
  SECTIONS,
  type SectionId,
  type SettingKey,
} from './config-meta';
import { type FieldIssue, issuesAt } from './config-validation';
import { ChoiceControl, ColorControl, NullableControl, NumberControl, OnOffControl, PairControl, TextControl } from './setting-controls';

export interface EditorState {
  layer: ConfigLayer;
  /** The layer document being edited (sparse). */
  doc: JsonObject;
  /** The published current version of this layer. */
  baseline: JsonObject;
  /** Defaults ⊕ layers above. */
  inherited: JsonObject;
  /** inherited ⊕ doc. */
  effective: JsonObject;
  sourceOf: (path: string) => string;
  issues: FieldIssue[];
  advanced: boolean;
  update: (next: JsonObject) => void;
  selectedProfile: string | null;
  onSelectProfile: (key: string) => void;
}

// ── Cards (sections) ────────────────────────────────────────────────────────────────────────────
interface CardDef {
  id: string;
  section: SectionId;
  title: string;
  description: string;
  icon: (typeof SECTIONS)[number]['icon'];
  keys: SettingKey[];
}

const EVERYDAY: CardDef[] = [];
const TECHNICAL: CardDef[] = [];
const TECHNICAL_TAIL: CardDef[] = [];
for (const s of SECTIONS) {
  const keys = keysForSection(s.id);
  if (keys.length === 0) continue;
  if (s.technical) {
    TECHNICAL_TAIL.push({ id: s.id, section: s.id, title: s.title, description: s.description, icon: s.icon, keys });
    continue;
  }
  const everyday = keys.filter((k) => !k.technical);
  const tech = keys.filter((k) => k.technical);
  if (everyday.length) EVERYDAY.push({ id: s.id, section: s.id, title: s.title, description: s.description, icon: s.icon, keys: everyday });
  if (tech.length) {
    TECHNICAL.push({ id: `${s.id}-technical`, section: s.id, title: `${s.title}: more settings`, description: 'Rarely changed. Mostly for engineers.', icon: s.icon, keys: tech });
  }
}
TECHNICAL.push(...TECHNICAL_TAIL);
const TECHNICAL_KEY_COUNT = TECHNICAL.reduce((n, c) => n + c.keys.length, 0);

// ── Small parts ─────────────────────────────────────────────────────────────────────────────────
export function SensitiveBadge() {
  return (
    <SimpleTooltip content="Security-sensitive. Needs a second admin's approval when four-eyes is on.">
      <span
        tabIndex={0}
        className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ShieldAlert className="size-3.5" /> Sensitive
      </span>
    </SimpleTooltip>
  );
}

function EditedBadge() {
  return <Badge tone="warning">Edited</Badge>;
}

function SourceBadge({ set, source }: { set: boolean; source: string }) {
  if (set) return <Badge tone="accent" className="px-2 text-sm">Set on this layer</Badge>;
  return (
    <Badge tone="neutral" className="px-2 text-sm font-normal">
      {source === 'Default' ? 'Default value' : `From ${source}`}
    </Badge>
  );
}

function Errors({ list }: { list: FieldIssue[] }) {
  if (list.length === 0) return null;
  return (
    <ul className="space-y-0.5" role="alert">
      {list.map((e, i) => (
        <li key={`${e.path}-${i}`} className="text-sm text-destructive">
          {e.message}
        </li>
      ))}
    </ul>
  );
}

function inheritWord(layer: ConfigLayer): string {
  return layer === 'global' ? 'default' : 'inherited';
}

function objectAt(v: unknown, path: string): Record<string, unknown> {
  const o = getPath(v, path);
  return isPlainObject(o) ? o : {};
}

function KeyHeader({ k, ctx, htmlFor, edited, badge }: { k: SettingKey; ctx: EditorState; htmlFor?: string; edited: boolean; badge?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={htmlFor} className="text-base font-medium leading-snug">
            {k.label}
          </label>
          {k.spec.integrityRelevant ? <SensitiveBadge /> : null}
          {edited ? <EditedBadge /> : null}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{k.help}</p>
        {ctx.advanced ? <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">{k.path}</p> : null}
      </div>
      {badge}
    </div>
  );
}

// ── Leaf setting ────────────────────────────────────────────────────────────────────────────────
const FONT_SUGGESTIONS = ['Roboto', 'Inter', 'Open Sans', 'Lato', 'Poppins', 'Noto Sans', 'Montserrat'];

function SettingControl({ k, id, value, onChange, invalid, ctx }: { k: SettingKey; id: string; value: unknown; onChange: (v: unknown) => void; invalid: boolean; ctx: EditorState }) {
  switch (k.spec.type) {
    case 'boolean':
      return <OnOffControl id={id} checked={value === true} onChange={onChange} labels={k.onOff} />;
    case 'integer':
    case 'number':
      return <NumberControl id={id} value={value} onChange={onChange} min={k.spec.min} max={k.spec.max} step={k.step} unit={k.unit} invalid={invalid} />;
    case 'enum':
      return <ChoiceControl id={id} value={value} onChange={onChange} options={(k.spec.values ?? []).map((v) => ({ value: v, label: k.options[v] ?? humanLabel(v) }))} />;
    case 'semver':
      return <TextControl id={id} value={value} onChange={onChange} mono placeholder="1.4.0" invalid={invalid} className="w-40" />;
    case 'int_pair':
      return <PairControl id={id} value={value} onChange={onChange} min={k.spec.min} max={k.spec.max} invalid={invalid} />;
    case 'string': {
      if (k.path === 'geofence.default_profile') {
        const profiles = objectAt(ctx.effective, 'geofence.profiles');
        return (
          <Select value={typeof value === 'string' ? value : undefined} onValueChange={onChange}>
            <SelectTrigger id={id} aria-invalid={invalid || undefined} className="h-10 max-w-xs text-base">
              <SelectValue placeholder="Choose a location type" />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(profiles).map((p) => (
                <SelectItem key={p} value={p} className="text-base">
                  {profileLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      const inner =
        k.path === 'theme.primary_color' ? (
          <ColorControl id={id} value={value} onChange={onChange} invalid={invalid} />
        ) : (
          <>
            <TextControl
              id={id}
              value={value}
              onChange={onChange}
              invalid={invalid}
              placeholder={k.placeholder}
              mono={k.path.startsWith('maps.') || k.path.startsWith('observability.')}
              list={k.path === 'theme.font_family' ? 'cfg-font-suggestions' : undefined}
            />
            {k.path === 'theme.font_family' ? (
              <datalist id="cfg-font-suggestions">
                {FONT_SUGGESTIONS.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            ) : null}
          </>
        );
      if (!k.spec.nullable) return inner;
      const fallback = k.path === 'theme.primary_color' ? '#1D4ED8' : k.path === 'theme.font_family' ? 'Roboto' : '';
      return (
        <NullableControl value={value ?? null} onChange={onChange} fallback={fallback}>
          {inner}
        </NullableControl>
      );
    }
    default:
      return null;
  }
}

function InheritedValue({ k, value }: { k: SettingKey; value: unknown }) {
  return (
    <p className="flex items-center gap-2 text-base font-semibold">
      {k.path === 'theme.primary_color' && typeof value === 'string' ? <span className="inline-block size-5 rounded border" style={{ background: value }} /> : null}
      {formatSettingValue(k, value)}
    </p>
  );
}

function OverrideActions({
  set,
  layer,
  inheritedText,
  onOverride,
  onInherit,
}: {
  set: boolean;
  layer: ConfigLayer;
  inheritedText: string;
  onOverride: () => void;
  onInherit: () => void;
}) {
  return set ? (
    <Button type="button" variant="ghost" className="h-auto min-h-9 w-fit whitespace-normal text-left text-muted-foreground" onClick={onInherit}>
      <Undo2 /> Use {inheritWord(layer)} value ({inheritedText})
    </Button>
  ) : (
    <Button type="button" variant="outline" className="w-fit" onClick={onOverride}>
      <Pencil /> Change for this layer
    </Button>
  );
}

function SettingRow({ k, ctx }: { k: SettingKey; ctx: EditorState }) {
  const id = `cfg-${k.path.replace(/\./g, '-')}`;
  const set = hasPath(ctx.doc, k.path);
  const own = getPath(ctx.doc, k.path);
  const inh = getPath(ctx.inherited, k.path);
  const edited = !jsonEqual(own, getPath(ctx.baseline, k.path));
  const errs = issuesAt(ctx.issues, k.path);
  const change = (v: unknown) => ctx.update(setIn(ctx.doc, k.path, v));
  return (
    <div className="grid gap-3 border-t py-4 first:border-t-0" data-config-path={k.path}>
      <KeyHeader k={k} ctx={ctx} htmlFor={set ? id : undefined} edited={edited} badge={<SourceBadge set={set} source={ctx.sourceOf(k.path)} />} />
      {set ? <SettingControl k={k} id={id} value={own} onChange={change} invalid={errs.length > 0} ctx={ctx} /> : <InheritedValue k={k} value={inh} />}
      <Errors list={errs} />
      <OverrideActions
        set={set}
        layer={ctx.layer}
        inheritedText={formatSettingValue(k, inh)}
        onOverride={() => change(inh === undefined ? k.spec.default : inh)}
        onInherit={() => ctx.update(deleteIn(ctx.doc, k.path))}
      />
    </div>
  );
}

// ── Location types (geofence.profiles) ──────────────────────────────────────────────────────────
const PROFILE_ORDER = Object.keys(DEFAULT_GEOFENCE_PROFILES);

function ProfileCard({ name, k, ctx, isDefault }: { name: string; k: SettingKey; ctx: EditorState; isDefault: boolean }) {
  const path = `${k.path}.${name}`;
  const own = objectAt(ctx.doc, k.path);
  const inh = objectAt(ctx.inherited, k.path);
  const set = Object.prototype.hasOwnProperty.call(own, name);
  const inherited = inh[name];
  const value = (set ? own[name] : inherited) as Record<string, unknown> | undefined;
  const edited = !jsonEqual(own[name], objectAt(ctx.baseline, k.path)[name]);
  const selected = ctx.selectedProfile === name;
  const cardErrors = issuesAt(ctx.issues, path).filter((i) => !PROFILE_FIELDS.some((f) => i.path === `${path}.${f.name}`));
  const v = value ?? {};
  return (
    <div
      role="group"
      aria-label={profileLabel(name)}
      onFocusCapture={() => ctx.onSelectProfile(name)}
      onPointerDown={() => ctx.onSelectProfile(name)}
      className={cn('rounded-lg border bg-card p-4 transition-shadow', selected && 'border-primary/60 ring-2 ring-primary/20')}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-semibold">{profileLabel(name)}</h4>
            {isDefault ? <Badge tone="info">Used for jobs without a type</Badge> : null}
            {edited ? <EditedBadge /> : null}
          </div>
          {ctx.advanced ? <p className="font-mono text-xs text-muted-foreground">{path}</p> : null}
        </div>
        <SourceBadge set={set} source={ctx.sourceOf(path)} />
      </div>

      {set ? (
        <div className="mt-3 grid gap-4">
          {PROFILE_FIELDS.map((f) => {
            const fid = `cfg-profile-${name}-${f.name}`;
            const errs = issuesAt(ctx.issues, `${path}.${f.name}`, true);
            return (
              <div key={f.name} className="grid gap-1.5">
                <div>
                  <label htmlFor={fid} className="text-sm font-medium">
                    {f.label}
                  </label>
                  <p className="text-xs text-muted-foreground">{f.help}</p>
                </div>
                <NumberControl
                  id={fid}
                  value={v[f.name]}
                  onChange={(n) => ctx.update(setIn(ctx.doc, `${path}.${f.name}`, n))}
                  min={PROFILE_BOUNDS[f.name].min}
                  max={PROFILE_BOUNDS[f.name].max}
                  step={f.step}
                  unit={f.unit}
                  invalid={errs.length > 0}
                  compact
                />
                <Errors list={errs} />
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <label htmlFor={`cfg-profile-${name}-checkin`} className="text-sm font-medium">
                {PROFILE_CHECKIN.label}
              </label>
              <p className="text-xs text-muted-foreground">{PROFILE_CHECKIN.help}</p>
            </div>
            <OnOffControl
              id={`cfg-profile-${name}-checkin`}
              checked={v[PROFILE_CHECKIN.name] === true}
              onChange={(b) => ctx.update(setIn(ctx.doc, `${path}.${PROFILE_CHECKIN.name}`, b))}
            />
          </div>
        </div>
      ) : (
        <dl className="mt-3 grid grid-cols-[minmax(0,max-content)_1fr] gap-x-4 gap-y-1 text-sm">
          {PROFILE_FIELDS.map((f) => (
            <div key={f.name} className="contents">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="text-base font-medium tabular-nums">
                {typeof v[f.name] === 'number' ? `${String(v[f.name])}${f.unit ? f.unit.suffix : ''}` : '—'}
              </dd>
            </div>
          ))}
          <dt className="text-muted-foreground">Check-in prompt</dt>
          <dd className="text-base font-medium">{v[PROFILE_CHECKIN.name] === true ? 'On' : 'Off'}</dd>
        </dl>
      )}

      <Errors list={cardErrors} />
      <div className="mt-3 flex flex-wrap gap-2">
        {!set ? (
          <Button type="button" variant="outline" onClick={() => ctx.update(setIn(ctx.doc, path, inherited))}>
            <Pencil /> Change for this layer
          </Button>
        ) : inherited !== undefined ? (
          <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => ctx.update(deleteIn(ctx.doc, path))}>
            <Undo2 /> Use {inheritWord(ctx.layer)} value
          </Button>
        ) : isDefault ? (
          <SimpleTooltip content="Jobs without a type use this one. Choose another type for them first.">
            <span tabIndex={0} className="inline-flex">
              <Button type="button" variant="ghost" disabled className="text-destructive">
                <Trash2 /> Remove location type
              </Button>
            </span>
          </SimpleTooltip>
        ) : (
          <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => ctx.update(deleteIn(ctx.doc, path))}>
            <Trash2 /> Remove location type
          </Button>
        )}
      </div>
    </div>
  );
}

function AddProfile({ existing, advanced, onAdd }: { existing: string[]; advanced: boolean; onAdd: (key: string, from: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [from, setFrom] = useState(existing.includes('standalone') ? 'standalone' : (existing[0] ?? ''));
  const key = toSnakeKey(name);
  const error = !name.trim() ? null : !CONFIG_KEY_RE.test(key) ? 'Use letters and numbers, starting with a letter' : existing.includes(key) ? 'That location type already exists' : null;
  if (!open) {
    return (
      <Button type="button" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <Plus /> Add location type
      </Button>
    );
  }
  return (
    <div className="grid gap-3 rounded-lg border border-dashed bg-muted/30 p-4">
      <p className="text-base font-medium">New location type</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor="cfg-new-profile" className="text-sm font-medium">
            Name
          </label>
          <Input id="cfg-new-profile" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Petrol station" className="h-10 text-base" autoFocus />
          {error ? <p className="text-sm text-destructive">{error}</p> : key && advanced ? <p className="text-xs text-muted-foreground">Saved as {key}</p> : null}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="cfg-new-profile-from" className="text-sm font-medium">
            Start with the values of
          </label>
          <Select value={from} onValueChange={setFrom}>
            <SelectTrigger id="cfg-new-profile-from" className="h-10 text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {existing.map((p) => (
                <SelectItem key={p} value={p} className="text-base">
                  {profileLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={!key || !!error}
          onClick={() => {
            onAdd(key, from);
            setOpen(false);
            setName('');
          }}
        >
          <Plus /> Add
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ProfilesEditor({ k, ctx }: { k: SettingKey; ctx: EditorState }) {
  const eff = objectAt(ctx.effective, k.path);
  const names = [...PROFILE_ORDER.filter((n) => n in eff), ...Object.keys(eff).filter((n) => !PROFILE_ORDER.includes(n)).sort()];
  const dflt = getPath(ctx.effective, 'geofence.default_profile');
  const edited = !jsonEqual(getPath(ctx.doc, k.path), getPath(ctx.baseline, k.path));
  const recordErrors = ctx.issues.filter((i) => i.path === k.path || (i.path.startsWith(`${k.path}.`) && !names.includes(i.path.split('.')[2] ?? '')));
  return (
    <div className="grid gap-3 border-t py-4 first:border-t-0" data-config-path={k.path}>
      <KeyHeader k={k} ctx={ctx} edited={edited} />
      <div className="grid gap-3">
        {names.map((n) => (
          <ProfileCard key={n} name={n} k={k} ctx={ctx} isDefault={dflt === n} />
        ))}
      </div>
      <Errors list={recordErrors} />
      <AddProfile
        existing={names}
        advanced={ctx.advanced}
        onAdd={(key, from) => {
          const start = eff[from] ?? DEFAULT_GEOFENCE_PROFILES.standalone;
          ctx.update(setIn(ctx.doc, `${k.path}.${key}`, start));
          ctx.onSelectProfile(key);
        }}
      />
    </div>
  );
}

// ── Feature flags ───────────────────────────────────────────────────────────────────────────────
function AddFlag({ existing, advanced, onAdd }: { existing: string[]; advanced: boolean; onAdd: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const key = toSnakeKey(name);
  const error = !name.trim() ? null : !CONFIG_KEY_RE.test(key) ? 'Use letters and numbers, starting with a letter' : existing.includes(key) ? 'That feature already exists' : null;
  if (!open) {
    return (
      <Button type="button" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <Plus /> Add feature
      </Button>
    );
  }
  return (
    <div className="grid gap-2 rounded-lg border border-dashed bg-muted/30 p-4">
      <label htmlFor="cfg-new-flag" className="text-sm font-medium">
        Feature name
      </label>
      <div className="flex flex-wrap gap-2">
        <Input id="cfg-new-flag" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Offline maps" className="h-10 max-w-xs text-base" autoFocus />
        <Button
          type="button"
          disabled={!key || !!error}
          onClick={() => {
            onAdd(key);
            setOpen(false);
            setName('');
          }}
        >
          <Plus /> Add (switched on)
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : key && advanced ? <p className="text-xs text-muted-foreground">Saved as features.{key}</p> : null}
      <p className="text-xs text-muted-foreground">A new feature only does something once the phone app knows about it.</p>
    </div>
  );
}

function FlagsEditor({ k, ctx }: { k: SettingKey; ctx: EditorState }) {
  const eff = objectAt(ctx.effective, k.path);
  const own = objectAt(ctx.doc, k.path);
  const inh = objectAt(ctx.inherited, k.path);
  const base = objectAt(ctx.baseline, k.path);
  const names = Object.keys(eff).sort();
  const edited = !jsonEqual(getPath(ctx.doc, k.path), getPath(ctx.baseline, k.path));
  return (
    <div className="grid gap-3 border-t py-4 first:border-t-0" data-config-path={k.path}>
      <KeyHeader k={k} ctx={ctx} edited={edited} />
      {names.length === 0 ? (
        <p className="text-sm text-muted-foreground">No optional features yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {names.map((n) => {
            const path = `${k.path}.${n}`;
            const set = Object.prototype.hasOwnProperty.call(own, n);
            const value = set ? own[n] : inh[n];
            const errs = issuesAt(ctx.issues, path);
            return (
              <li key={n} className="grid gap-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={`cfg-flag-${n}`} className="text-base font-medium">
                        {humanLabel(n)}
                      </label>
                      {!jsonEqual(own[n], base[n]) ? <EditedBadge /> : null}
                    </div>
                    {ctx.advanced ? <p className="font-mono text-xs text-muted-foreground">{path}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <SourceBadge set={set} source={ctx.sourceOf(path)} />
                    <OnOffControl id={`cfg-flag-${n}`} checked={value === true} disabled={!set} onChange={(b) => ctx.update(setIn(ctx.doc, path, b))} />
                  </div>
                </div>
                <Errors list={errs} />
                <div className="flex flex-wrap gap-2">
                  {!set ? (
                    <Button type="button" variant="outline" className="w-fit" onClick={() => ctx.update(setIn(ctx.doc, path, inh[n]))}>
                      <Pencil /> Change for this layer
                    </Button>
                  ) : inh[n] !== undefined ? (
                    <Button type="button" variant="ghost" className="w-fit text-muted-foreground" onClick={() => ctx.update(deleteIn(ctx.doc, path))}>
                      <Undo2 /> Use {inheritWord(ctx.layer)} value ({inh[n] === true ? 'On' : 'Off'})
                    </Button>
                  ) : (
                    <Button type="button" variant="ghost" className="w-fit text-destructive hover:text-destructive" onClick={() => ctx.update(deleteIn(ctx.doc, path))}>
                      <Trash2 /> Remove feature
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Errors list={issuesAt(ctx.issues, k.path, true)} />
      <AddFlag existing={names} advanced={ctx.advanced} onAdd={(key) => ctx.update(setIn(ctx.doc, `${k.path}.${key}`, true))} />
    </div>
  );
}

function KeyRow({ k, ctx }: { k: SettingKey; ctx: EditorState }) {
  if (k.spec.type === 'profiles') return <ProfilesEditor k={k} ctx={ctx} />;
  if (k.spec.type === 'flags') return <FlagsEditor k={k} ctx={ctx} />;
  return <SettingRow k={k} ctx={ctx} />;
}

function SectionCard({ card, ctx, open, onToggle, active, onActivate }: { card: CardDef; ctx: EditorState; open: boolean; onToggle: () => void; active: boolean; onActivate: () => void }) {
  const Icon = card.icon;
  const setCount = card.keys.filter((k) => hasPath(ctx.doc, k.path)).length;
  const editedCount = card.keys.filter((k) => !jsonEqual(getPath(ctx.doc, k.path), getPath(ctx.baseline, k.path))).length;
  const errCount = card.keys.reduce((n, k) => n + issuesAt(ctx.issues, k.path).length, 0);
  return (
    <section
      id={`cfg-section-${card.id}`}
      onFocusCapture={onActivate}
      onPointerDown={onActivate}
      className={cn('scroll-mt-40 rounded-lg border bg-card shadow-xs transition-shadow', active && 'border-primary/50 ring-2 ring-primary/15')}
    >
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex w-full items-start gap-3 rounded-lg px-4 py-3.5 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold">{card.title}</span>
            <span className="block text-sm text-muted-foreground">{card.description}</span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 pt-0.5">
            {errCount > 0 ? <Badge tone="danger">{errCount === 1 ? '1 problem' : `${errCount} problems`}</Badge> : null}
            {editedCount > 0 ? <Badge tone="warning">{editedCount} edited</Badge> : null}
            {setCount > 0 && ctx.layer !== 'global' ? <Badge tone="accent">{setCount} set here</Badge> : null}
            <ChevronDown className={cn('size-5 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </span>
        </button>
      </h3>
      {open ? (
        <div className="border-t px-4 pb-1">
          {card.keys.map((k) => (
            <KeyRow key={k.path} k={k} ctx={ctx} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** All sections; reports the section being worked on so the phone preview can follow it. */
export function SettingsEditor({ ctx, activeSection, onActiveSection }: { ctx: EditorState; activeSection: SectionId; onActiveSection: (id: SectionId) => void }) {
  const { setViewMode } = usePreferences();
  const [open, setOpen] = useState<Set<string>>(() => new Set(['availability']));
  const [activeCard, setActiveCard] = useState<string>('availability');
  const cards = ctx.advanced ? [...EVERYDAY, ...TECHNICAL] : EVERYDAY;
  const hiddenSet = ctx.advanced ? 0 : TECHNICAL.reduce((n, c) => n + c.keys.filter((k) => hasPath(ctx.doc, k.path)).length, 0);
  const hiddenErrors = ctx.advanced ? 0 : TECHNICAL.reduce((n, c) => n + c.keys.reduce((m, k) => m + issuesAt(ctx.issues, k.path).length, 0), 0);

  const renderCard = (c: CardDef) => (
    <SectionCard
      key={c.id}
      card={c}
      ctx={ctx}
      open={open.has(c.id)}
      active={activeCard === c.id && activeSection === c.section}
      onActivate={() => {
        setActiveCard(c.id);
        if (activeSection !== c.section) onActiveSection(c.section);
      }}
      onToggle={() =>
        setOpen((prev) => {
          const next = new Set(prev);
          if (next.has(c.id)) next.delete(c.id);
          else next.add(c.id);
          return next;
        })
      }
    />
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Open a section to change it. The phone preview follows the section you are working on.</p>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" onClick={() => setOpen(new Set(cards.map((c) => c.id)))}>
            Open all
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(new Set())}>
            Close all
          </Button>
        </div>
      </div>
      {EVERYDAY.map(renderCard)}
      {ctx.advanced ? (
        <>
          <div className="pt-4">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Wrench className="size-5 text-muted-foreground" /> Technical settings
            </h3>
            <p className="text-sm text-muted-foreground">For engineers. These rarely change, and a wrong value can stop phones from working properly.</p>
          </div>
          {TECHNICAL.map(renderCard)}
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed bg-card px-4 py-3 text-sm text-muted-foreground">
          <p className="min-w-0 flex-1">
            {TECHNICAL_KEY_COUNT} technical settings (sign-in, maps, monitoring, locale and a few more) are hidden in Basic view.
            {hiddenSet > 0 ? ` ${hiddenSet} of them are set on this layer; they are kept exactly as they are.` : ''}
            {hiddenErrors > 0 ? <span className="font-medium text-destructive">{` ${hiddenErrors} of them have a problem.`}</span> : null}
          </p>
          <Button type="button" variant="outline" onClick={() => setViewMode('advanced')}>
            Show technical settings
          </Button>
        </div>
      )}
    </div>
  );
}
