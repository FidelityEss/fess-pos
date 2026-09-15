'use client';

// Live phone preview for App settings: renders the *effective* values being edited (defaults ⊕ layers above ⊕ this
// layer's edits) as the screen the section in focus affects. These scenes show what the phone does with a setting (the
// location fence to scale, update gates, a rooted phone, full storage), which the phone app can't act out in a browser, so
// they stay drawings. They draw with the design tokens only (T3-12: no colours of their own; schema/design/tokens.json
// through lib/brand.ts and the phone's CSS variables) at a real phone's width, scaled to fit the column.
import { Briefcase, Camera, CheckCircle2, Home, MapPin, QrCode, Receipt, ShieldAlert, User } from 'lucide-react';
import { useState } from 'react';
import { MODULE_PHONE } from '@/components/preview/module-preview-bridge';
import {
  PhoneBanner,
  PhoneButton,
  PhoneCard,
  PhoneChip,
  PhoneFrame,
  type PhoneNavItem,
  PhoneSection,
  type PhoneTheme,
} from '@/components/preview/phone-frame';
import { toneColors } from '@/components/preview/phone-style';
import { type PreviewContext, samplePreviewContext } from '@/components/preview/sample-context';
import { PHONE_OUTER_WIDTH, ScaleToFit } from '@/components/preview/scale-to-fit';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FESS, fessTint } from '@/lib/brand';
import type { JsonObject } from '@/lib/types';
import { cn, isPlainObject } from '@/lib/utils';
import { getPath } from './config-doc';
import { fillTemplate } from './config-data';
import { profileLabel, type SectionId } from './config-meta';
import { ChoiceControl } from './setting-controls';

type Scene = 'home' | 'availability' | 'updates' | 'location' | 'photos' | 'security' | 'sync' | 'assignment' | 'agent_card';

const SCENES: { id: Scene; label: string }[] = [
  { id: 'home', label: 'Home screen' },
  { id: 'availability', label: 'App on or off' },
  { id: 'updates', label: 'Asking for an update' },
  { id: 'location', label: 'Checking the location' },
  { id: 'photos', label: 'Taking a photo' },
  { id: 'security', label: 'Phone security check' },
  { id: 'sync', label: 'Uploading and storage' },
  { id: 'assignment', label: 'A new job' },
  { id: 'agent_card', label: 'Agent card' },
];

function sceneFor(section: SectionId): Scene {
  switch (section) {
    case 'availability':
    case 'updates':
    case 'location':
    case 'photos':
    case 'security':
    case 'sync':
    case 'assignment':
    case 'agent_card':
      return section;
    default:
      return 'home';
  }
}

const NAV: PhoneNavItem[] = [
  { label: 'Home', icon: Home, active: true },
  { label: 'Jobs', icon: Briefcase },
  { label: 'Receipts', icon: Receipt },
  { label: 'Me', icon: User },
];

/** Every phone here: a real phone's screen (T3-12). */
const FRAME = { width: PHONE_OUTER_WIDTH, height: MODULE_PHONE.height };

/** Secondary text inside the phone (the token's muted grey, through PhoneFrame's CSS variables). */
const MUTED = 'text-[12px] text-[color:var(--ph-muted)]';
/** A box where one is needed (component.card): the card's border and background. */
const BOX = 'rounded-[var(--ph-card-r)] border-[length:var(--ph-card-bw)] border-[color:var(--ph-card-border)] bg-[color:var(--ph-card-bg)]';

function num(values: JsonObject, path: string, fallback: number): number {
  const v = getPath(values, path);
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(values: JsonObject, path: string): string | null {
  const v = getPath(values, path);
  return typeof v === 'string' && v ? v : null;
}

function semver(v: unknown): [number, number, number] {
  const m = typeof v === 'string' ? /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim()) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

function below(installed: string, min: unknown): boolean {
  const a = semver(installed);
  const b = semver(min);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

function timeRange(ctx: PreviewContext): string {
  const f = (iso: string) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${f(ctx.job.scheduled.start)}–${f(ctx.job.scheduled.end)}`;
}

// ── Shared screen pieces ────────────────────────────────────────────────────────────────────────
function SyncLine({ text, tone = 'ok' }: { text: string; tone?: 'ok' | 'pending' }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-[color:var(--ph-body)]">
      <span className="size-2 rounded-full" style={{ backgroundColor: tone === 'ok' ? FESS.success : FESS.warning }} />
      {text}
    </div>
  );
}

function JobCard({ ctx, bankName, startLabel = 'Start inspection', startDisabled, note }: { ctx: PreviewContext; bankName: string; startLabel?: string; startDisabled?: boolean; note?: string }) {
  return (
    <PhoneCard>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{ctx.job.merchant_name}</div>
          <div className={MUTED}>
            {ctx.job.address.line1}, {ctx.job.address.suburb}
          </div>
        </div>
        <PhoneChip tone="primary">Today</PhoneChip>
      </div>
      <div className={cn('mt-1', MUTED)}>
        {ctx.job.reference} · {timeRange(ctx)} · {bankName}
      </div>
      <div className="mt-3">
        <PhoneButton disabled={startDisabled}>{startLabel}</PhoneButton>
      </div>
      {note ? <p className={cn('mt-2', MUTED)}>{note}</p> : null}
    </PhoneCard>
  );
}

/** The home stats as the app draws them (the bundled home view, D-97): one flat strip, cells between hairlines. */
function StatStrip({ ctx }: { ctx: PreviewContext }) {
  const tiles = [
    { label: 'Active', value: ctx.stats.active ?? 0 },
    { label: 'Due today', value: ctx.stats.due_today ?? 0 },
    { label: 'Returned', value: ctx.stats.returned ?? 0 },
  ];
  return (
    <div className="mt-2 flex border-y border-[color:var(--ph-divider)]">
      {tiles.map((t, i) => (
        <div key={t.label} className={cn('flex-1 px-3 py-3.5', i > 0 && 'border-l border-[color:var(--ph-divider)]')}>
          <div style={{ fontSize: FESS.stat.number.size, fontWeight: FESS.stat.number.weight, color: 'var(--pp)' }}>{t.value}</div>
          <div style={{ fontSize: FESS.stat.label.size, fontWeight: FESS.stat.label.weight, color: FESS.stat.label.color }}>{t.label}</div>
        </div>
      ))}
    </div>
  );
}

function HomeBody({
  ctx,
  bankName,
  syncText,
  syncTone,
  startDisabled,
  startNote,
  extra,
}: {
  ctx: PreviewContext;
  bankName: string;
  syncText: string;
  syncTone?: 'ok' | 'pending';
  startDisabled?: boolean;
  startNote?: string;
  extra?: React.ReactNode;
}) {
  return (
    <>
      <PhoneSection>
        <div className="text-[15px] font-semibold">Hi {ctx.agent.first_name}</div>
        <SyncLine text={syncText} tone={syncTone} />
      </PhoneSection>
      {extra}
      <StatStrip ctx={ctx} />
      <PhoneSection title="Next visit" className="pb-3">
        <JobCard ctx={ctx} bankName={bankName} startDisabled={startDisabled} note={startNote} />
      </PhoneSection>
    </>
  );
}

// ── Location check map ──────────────────────────────────────────────────────────────────────────
const NICE = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
const AGENT_INSIDE = 0.55;
const AGENT_OUTSIDE = 1.3;

/** The map's colours, from the tokens: a pale ground, blocks in the divider grey, white roads, a park in a green tint. */
const MAP = {
  ground: FESS.bgSubtle,
  block: FESS.divider,
  park: fessTint(FESS.success),
  road: FESS.bgPage,
  label: FESS.bgPage,
  scale: FESS.textBody,
  agent: FESS.info,
  override: FESS.warning,
  overrideText: FESS.warningText,
};

function FenceMap({ radiusM, accuracyM, overrideM, inside }: { radiusM: number; accuracyM: number; overrideM: number; inside: boolean }) {
  const W = 276;
  const H = 230;
  const cx = W / 2;
  const cy = H / 2 - 4;
  const reach = Math.max(overrideM, radiusM * 1.45, 30);
  const mpp = reach / 100; // metres per phone pixel: the farthest ring fits in 100 px
  const r = radiusM / mpp;
  const o = overrideM / mpp;
  const distM = inside ? radiusM * AGENT_INSIDE : radiusM * AGENT_OUTSIDE;
  const ang = 0.6; // down-right of the pin, so the dot never covers the pin head
  const ax = cx + (Math.cos(ang) * distM) / mpp;
  const ay = cy + (Math.sin(ang) * distM) / mpp;
  const accPx = Math.max(accuracyM / mpp, 3);
  const bar = [...NICE].reverse().find((d) => d / mpp <= 80) ?? 5;
  const barPx = bar / mpp;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Map: fence of ${radiusM} metres around the merchant`}>
      <rect width={W} height={H} style={{ fill: MAP.ground }} />
      <rect x="12" y="14" width="70" height="52" rx="4" style={{ fill: MAP.block }} />
      <rect x="196" y="160" width="70" height="56" rx="4" style={{ fill: MAP.block }} />
      <rect x="18" y="160" width="84" height="58" rx="4" style={{ fill: MAP.park }} />
      <rect x="190" y="12" width="76" height="60" rx="4" style={{ fill: MAP.block }} />
      <path d={`M0 ${H * 0.62} L${W} ${H * 0.5}`} style={{ stroke: MAP.road }} strokeWidth="11" />
      <path d={`M${W * 0.36} 0 L${W * 0.42} ${H}`} style={{ stroke: MAP.road }} strokeWidth="9" />
      <path d={`M${W * 0.78} 0 L${W * 0.72} ${H}`} style={{ stroke: MAP.road }} strokeWidth="6" />
      {o > r + 1 ? <circle cx={cx} cy={cy} r={o} fill="none" style={{ stroke: MAP.override }} strokeWidth="1.5" strokeDasharray="5 4" /> : null}
      <circle cx={cx} cy={cy} r={r} style={{ fill: 'var(--pp)', stroke: 'var(--pp)' }} fillOpacity="0.13" strokeWidth="2" />
      <g transform={`translate(${cx} ${cy})`}>
        <path d="M0 0 C -2 -6 -9 -10 -9 -17 A 9 9 0 1 1 9 -17 C 9 -10 2 -6 0 0 Z" style={{ fill: 'var(--pp)', stroke: MAP.label }} strokeWidth="1.5" />
        <circle cx="0" cy="-17" r="3.4" style={{ fill: MAP.label }} />
      </g>
      <circle cx={ax} cy={ay} r={accPx} style={{ fill: MAP.agent, stroke: MAP.agent }} fillOpacity="0.16" strokeOpacity="0.45" />
      <circle cx={ax} cy={ay} r="5.5" style={{ fill: MAP.agent, stroke: MAP.label }} strokeWidth="2" />
      <text x={cx} y={Math.max(cy - r - 5, 11)} textAnchor="middle" fontSize="11" fontWeight="600" style={{ fill: 'var(--pp)' }}>
        Fence {radiusM} m
      </text>
      <g transform={`translate(10 ${H - 12})`}>
        <rect x="-4" y="-14" width={barPx + 44} height="20" rx="4" style={{ fill: MAP.label }} />
        <path d={`M0 -6 V0 H${barPx} V-6`} fill="none" style={{ stroke: MAP.scale }} strokeWidth="1.5" />
        <text x={barPx + 5} y="0" fontSize="10" style={{ fill: MAP.scale }}>
          {bar} m
        </text>
      </g>
      {o > r + 1 ? (
        <g transform={`translate(${W - 10} ${H - 12})`}>
          <rect x="-128" y="-14" width="124" height="20" rx="4" style={{ fill: MAP.label }} />
          <path d="M-122 -4 H-106" style={{ stroke: MAP.override }} strokeWidth="1.5" strokeDasharray="4 3" />
          <text x="-102" y="0" fontSize="10" style={{ fill: MAP.overrideText }}>
            Override up to {Math.round(overrideM)} m
          </text>
        </g>
      ) : null}
    </svg>
  );
}

// ── Scenes ──────────────────────────────────────────────────────────────────────────────────────
interface SceneProps {
  values: JsonObject;
  strings: Record<string, string>;
  ctx: PreviewContext;
  bankName: string;
  theme: PhoneTheme;
}

const s = (strings: Record<string, string>, key: string, fallback: string) => strings[key] ?? fallback;

function HomeScene({ values, strings, ctx, bankName, theme }: SceneProps) {
  const paused = getPath(values, 'inspections.start_enabled') === false;
  return (
    <PhoneFrame {...FRAME} title="POS inspections" theme={theme} bottomNav={NAV}>
      <HomeBody ctx={ctx} bankName={bankName} syncText={s(strings, 'sync.synced', 'Synced')} startDisabled={paused} />
    </PhoneFrame>
  );
}

function AvailabilityScene({ values, strings, ctx, bankName, theme }: SceneProps) {
  const posOn = getPath(values, 'pos.enabled') !== false;
  const startOn = getPath(values, 'inspections.start_enabled') !== false;
  const web = getPath(values, 'client_mode') === 'web';
  if (!posOn) {
    const tiles = ['Payslips', 'Leave', 'Roster', 'Documents', 'Training'];
    return (
      <PhoneFrame {...FRAME} title="FESS" theme={theme}>
        <PhoneSection title="Services">
          <div className="grid grid-cols-3 gap-2">
            {tiles.map((t) => (
              <div key={t} className={cn('flex aspect-square flex-col items-center justify-center gap-1 text-[12px] font-medium', BOX)}>
                <span className="size-6 rounded-md bg-[color:var(--ph-subtle)]" />
                {t}
              </div>
            ))}
            <div className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[var(--ph-card-r)] border-2 border-dashed border-[color:var(--ph-border)] text-center text-[11px] text-[color:var(--ph-muted)]">
              POS
              <br />
              hidden
            </div>
          </div>
        </PhoneSection>
        <PhoneSection>
          <p className={MUTED}>The POS entry does not appear in FESS. Work already captured keeps uploading in the background.</p>
        </PhoneSection>
      </PhoneFrame>
    );
  }
  return (
    <PhoneFrame
      {...FRAME}
      title="POS inspections"
      theme={theme}
      bottomNav={NAV}
      banner={
        !startOn ? (
          <PhoneBanner tone="warning">{s(strings, 'inspections.paused', 'Starting new inspections is paused. You can finish inspections you have started, and uploads continue.')}</PhoneBanner>
        ) : web ? (
          <PhoneBanner tone="info">{s(strings, 'client.web_mode', 'POS now opens in the web app.')}</PhoneBanner>
        ) : undefined
      }
    >
      <HomeBody ctx={ctx} bankName={bankName} syncText={s(strings, 'sync.synced', 'Synced')} startDisabled={!startOn} startNote={!startOn ? 'New inspections are paused.' : undefined} />
    </PhoneFrame>
  );
}

function UpdatesScene({ values, strings, ctx, bankName, theme, installed }: SceneProps & { installed: string }) {
  const nag = getPath(values, 'min_module_version.nag');
  const newWork = getPath(values, 'min_module_version.new_work');
  const bip = getPath(values, 'min_module_version.block_in_progress');
  if (below(installed, bip)) {
    return (
      <PhoneFrame
        {...FRAME}
        title="Inspection"
        showBack
        theme={theme}
        banner={<PhoneBanner tone="danger">{s(strings, 'update.required_in_progress', 'Update FESS to continue this inspection. Anything already captured will still upload.')}</PhoneBanner>}
      >
        <PhoneSection>
          <PhoneCard>
            <div className="font-semibold">{ctx.job.merchant_name}</div>
            <div className={MUTED}>Inspection started · 3 of 7 steps done</div>
            <div className="mt-3 grid gap-2">
              <PhoneButton>Update FESS</PhoneButton>
              <PhoneButton variant="outline" disabled>
                Continue inspection
              </PhoneButton>
            </div>
          </PhoneCard>
        </PhoneSection>
      </PhoneFrame>
    );
  }
  if (below(installed, newWork)) {
    return (
      <PhoneFrame {...FRAME} title={ctx.job.reference} showBack theme={theme} banner={<PhoneBanner tone="warning">{s(strings, 'update.required', 'Update FESS to start this inspection.')}</PhoneBanner>}>
        <PhoneSection>
          <PhoneCard>
            <div className="font-semibold">{ctx.job.merchant_name}</div>
            <div className={MUTED}>
              {ctx.job.address.line1}, {ctx.job.address.suburb}
            </div>
            <div className="mt-3 grid gap-2">
              <PhoneButton>Update FESS</PhoneButton>
              <PhoneButton variant="outline" disabled>
                Start inspection
              </PhoneButton>
            </div>
          </PhoneCard>
        </PhoneSection>
      </PhoneFrame>
    );
  }
  return (
    <PhoneFrame
      {...FRAME}
      title="POS inspections"
      theme={theme}
      bottomNav={NAV}
      banner={below(installed, nag) ? <PhoneBanner tone="info">{s(strings, 'update.available', 'A new version of FESS is available. Please update when you can.')}</PhoneBanner> : undefined}
    >
      <HomeBody ctx={ctx} bankName={bankName} syncText={s(strings, 'sync.synced', 'Synced')} />
    </PhoneFrame>
  );
}

function LocationScene({ values, strings, ctx, theme, profile, inside }: SceneProps & { profile: string; inside: boolean }) {
  const p = getPath(values, `geofence.profiles.${profile}`);
  const po = isPlainObject(p) ? p : {};
  const radius = typeof po.radius_m === 'number' ? po.radius_m : 75;
  const acc = typeof po.max_accuracy_m === 'number' ? po.max_accuracy_m : 30;
  const prompt = po.prompt_checkin_on_arrival === true;
  const overrideM = Math.min(radius * num(values, 'geofence.override_radius_multiplier', 2), num(values, 'geofence.override_max_m', 500));
  const reading = Math.min(inside ? 12 : 18, acc);
  const distance = Math.round(radius * (inside ? AGENT_INSIDE : AGENT_OUTSIDE));
  const outsideFix = getPath(values, 'geofence.outside_fix.allowed') !== false;
  const ok = toneColors('success');
  return (
    <PhoneFrame
      {...FRAME}
      title="Check location"
      showBack
      theme={theme}
      banner={inside ? undefined : <PhoneBanner tone="danger">{s(strings, 'location.outside_fence', "You're outside the expected location for this merchant.")}</PhoneBanner>}
    >
      <PhoneSection>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-semibold">{ctx.job.merchant_name}</div>
            <div className={MUTED}>{ctx.job.address.line1}</div>
          </div>
          <PhoneChip tone="primary">{profileLabel(profile)}</PhoneChip>
        </div>
      </PhoneSection>
      <PhoneSection>
        <div className={cn('overflow-hidden', BOX)}>
          <FenceMap radiusM={radius} accuracyM={reading} overrideM={overrideM} inside={inside} />
        </div>
        <p className={cn('mt-1.5', MUTED)}>
          {fillTemplate(s(strings, 'location.sampling', 'Getting an accurate location… accuracy {{accuracy}} m'), { accuracy: reading })}
          {` · checks for ${num(values, 'geofence.sample_seconds', 60)} s`}
        </p>
      </PhoneSection>
      {inside ? (
        <PhoneSection className="grid gap-2 pb-3">
          <div className="rounded-[var(--ph-card-r)] border p-4" style={{ backgroundColor: ok.background, borderColor: ok.background, color: ok.foreground }}>
            <div className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="size-4" /> You&apos;re at the merchant
            </div>
            <div className="text-[12px]">
              About {distance} m from the pin · accuracy ±{reading} m (needs ±{acc} m or better)
            </div>
          </div>
          {prompt ? (
            <PhoneCard>
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-[var(--pp)]" />
                <div className="text-[13px]">{s(strings, 'location.checkin_prompt', 'Record your location outside the premises before you go in.')}</div>
              </div>
              <div className="mt-2">
                <PhoneButton variant="outline">Record location</PhoneButton>
              </div>
            </PhoneCard>
          ) : null}
          <PhoneButton>Start inspection</PhoneButton>
        </PhoneSection>
      ) : (
        <PhoneSection className="grid gap-2 pb-3">
          <PhoneCard>
            <div className="text-[13px]">
              You are about <b>{distance} m</b> from the merchant. The fence is {radius} m.
            </div>
            <div className={cn('mt-1', MUTED)}>You can ask for an override within {Math.round(overrideM)} m. A reason is required and your supervisor is told.</div>
            <div className="mt-2">
              <PhoneButton variant="outline">Request override</PhoneButton>
            </div>
          </PhoneCard>
          {outsideFix ? (
            <p className={cn('px-1', MUTED)}>
              No GPS signal inside? A location recorded just outside in the last {num(values, 'geofence.outside_fix.valid_minutes', 20)} minutes, accurate to ±
              {num(values, 'geofence.outside_fix.max_accuracy_m', 30)} m, also counts.
            </p>
          ) : null}
          <PhoneButton disabled>Start inspection</PhoneButton>
        </PhoneSection>
      )}
    </PhoneFrame>
  );
}

/** A camera's view, drawn in the token greys: a dark scene with a shop front, a white shutter. */
const CAMERA = {
  sceneTop: FESS.textBody,
  sceneBottom: FESS.text,
  wall: FESS.textMuted,
  roof: FESS.border,
  door: FESS.textBody,
  window: FESS.divider,
  light: FESS.bgPage,
};

function PhotosScene({ values, theme }: SceneProps) {
  const long = num(values, 'photos.max_long_edge_px', 2048);
  const q = num(values, 'photos.jpeg_quality', 80);
  const short = Math.round(long * 0.75);
  const mb = (long * short * (0.8 + (q - 50) * 0.05)) / 8 / 1_000_000; // rough JPEG estimate (bits per pixel grows with quality)
  return (
    <PhoneFrame {...FRAME} title="Photo: shop front" showBack theme={theme}>
      <div className="relative mx-3 mt-3 aspect-[3/4] overflow-hidden rounded-xl" style={{ backgroundImage: `linear-gradient(${CAMERA.sceneTop}, ${CAMERA.sceneBottom})` }}>
        <svg viewBox="0 0 120 160" className="absolute inset-0 size-full opacity-60" aria-hidden>
          <rect x="18" y="62" width="84" height="70" style={{ fill: CAMERA.wall }} />
          <rect x="14" y="52" width="92" height="14" style={{ fill: CAMERA.roof }} />
          <rect x="28" y="84" width="26" height="48" style={{ fill: CAMERA.door }} />
          <rect x="64" y="80" width="28" height="22" style={{ fill: CAMERA.window }} />
          <path d="M40 0V160M80 0V160M0 53H120M0 107H120" style={{ stroke: CAMERA.light }} strokeOpacity="0.25" strokeWidth="0.6" />
        </svg>
        <span
          className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: `color-mix(in srgb, ${CAMERA.sceneBottom} 60%, transparent)`, color: CAMERA.light }}
        >
          <Camera className="size-3" /> Camera only
        </span>
        <span
          className="absolute bottom-3 left-1/2 size-14 -translate-x-1/2 rounded-full border-4"
          style={{ borderColor: CAMERA.light, backgroundColor: `color-mix(in srgb, ${CAMERA.light} 30%, transparent)` }}
        />
      </div>
      <PhoneSection className="pb-3">
        <PhoneCard>
          <div className="text-[13px] font-semibold">Saved photo</div>
          <div className="text-[13px]">
            {long.toLocaleString('en-ZA')} × {short.toLocaleString('en-ZA')} px · quality {q}%
          </div>
          <div className={MUTED}>About {mb < 1 ? `${Math.round(mb * 1000)} KB` : `${mb.toFixed(1)} MB`} each (estimate)</div>
          <div className={cn('mt-1', MUTED)}>Photos come from the camera only and are sealed with a fingerprint when taken.</div>
        </PhoneCard>
      </PhoneSection>
    </PhoneFrame>
  );
}

function SecurityScene({ values, theme, state }: SceneProps & { state: 'normal' | 'mock' | 'root' }) {
  const blockMock = getPath(values, 'integrity.block_on_mock') !== false;
  const blockRoot = getPath(values, 'integrity.block_on_root') !== false;
  const blocked = (state === 'mock' && blockMock) || (state === 'root' && blockRoot);
  const allowedAnyway = (state === 'mock' && !blockMock) || (state === 'root' && !blockRoot);
  const problem = state === 'mock' ? 'A fake-location app is on.' : 'This phone is rooted or jailbroken.';
  return (
    <PhoneFrame
      {...FRAME}
      title="Before you start"
      showBack
      theme={theme}
      banner={
        blocked ? (
          <PhoneBanner tone="danger">
            {problem} {state === 'mock' ? 'Turn it off to start the inspection.' : 'Inspections cannot be started on this phone.'}
          </PhoneBanner>
        ) : allowedAnyway ? (
          <PhoneBanner tone="warning">{problem} Allowed by your settings; the inspection will be flagged for review.</PhoneBanner>
        ) : undefined
      }
    >
      <PhoneSection title="Checks" className="pb-3">
        <PhoneCard className="grid gap-2">
          {[
            { label: 'Real location (no fake-location app)', ok: state !== 'mock', rule: blockMock ? 'Required' : 'Not required' },
            { label: 'Phone security intact', ok: state !== 'root', rule: blockRoot ? 'Required' : 'Not required' },
            { label: 'Camera ready', ok: true, rule: 'Required' },
          ].map((c) => (
            <div key={c.label} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="flex items-center gap-1.5">
                {c.ok ? <CheckCircle2 className="size-4" style={{ color: FESS.success }} /> : <ShieldAlert className="size-4" style={{ color: FESS.error }} />}
                {c.label}
              </span>
              <PhoneChip tone={c.rule === 'Required' ? 'primary' : 'neutral'}>{c.rule}</PhoneChip>
            </div>
          ))}
        </PhoneCard>
        <div className="mt-3">
          <PhoneButton disabled={blocked}>Start inspection</PhoneButton>
        </div>
      </PhoneSection>
    </PhoneFrame>
  );
}

function SyncScene({ values, strings, ctx, bankName, theme, usedPct }: SceneProps & { usedPct: number }) {
  const cap = num(values, 'storage.cap_mb', 500);
  const at = num(values, 'storage.block_new_work_at_pct', 80);
  const every = num(values, 'sync.foreground_interval_s', 60);
  const full = usedPct >= at;
  const used = Math.round((cap * usedPct) / 100);
  return (
    <PhoneFrame
      {...FRAME}
      title="POS inspections"
      theme={theme}
      bottomNav={NAV}
      banner={
        full ? (
          <PhoneBanner tone="warning">
            {s(strings, 'storage.almost_full', 'Storage for POS is almost full ({{used}} of {{cap}} MB). New inspections are paused until uploads free up space.')
              .replace('{{used}}', String(used))
              .replace('{{cap}}', String(cap))}
          </PhoneBanner>
        ) : undefined
      }
    >
      <HomeBody
        ctx={ctx}
        bankName={bankName}
        syncText={`${fillTemplate(s(strings, 'sync.pending', '{{count}} items waiting to upload'), { count: 3 })} · tries every ${every < 120 ? `${every} s` : `${Math.round(every / 60)} min`}`}
        syncTone="pending"
        startDisabled={full}
        startNote={full ? 'Paused until there is space.' : undefined}
        extra={
          <PhoneSection title="Storage">
            <PhoneCard>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12px]">
                <span className="font-semibold">
                  {used} of {cap} MB used
                </span>
                <span className="text-[color:var(--ph-muted)]">pauses at {at}%</span>
              </div>
              <div className="relative mt-1.5 h-2 rounded-full bg-[color:var(--ph-divider)]">
                <div className="h-2 rounded-full" style={{ width: `${Math.min(usedPct, 100)}%`, backgroundColor: full ? FESS.warning : 'var(--pp)' }} />
                <div className="absolute -top-1 h-4 w-0.5" style={{ left: `${at}%`, backgroundColor: FESS.text }} />
              </div>
            </PhoneCard>
          </PhoneSection>
        }
      />
    </PhoneFrame>
  );
}

function AssignmentScene({ values, ctx, bankName, theme }: SceneProps) {
  const h = num(values, 'assignment.response_timeout_h', 24);
  return (
    <PhoneFrame {...FRAME} title="New job" showBack theme={theme}>
      <PhoneSection className="pb-3">
        <PhoneCard>
          <PhoneChip tone="warning">Waiting for your answer</PhoneChip>
          <div className="mt-2 font-semibold">{ctx.job.merchant_name}</div>
          <div className={MUTED}>
            {ctx.job.address.line1}, {ctx.job.address.suburb} · {bankName}
          </div>
          <div className="mt-2 text-[13px]">
            Please accept or reject within <b>{h === 1 ? '1 hour' : `${h} hours`}</b>. After that the job goes to another agent.
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <PhoneButton variant="outline">Reject</PhoneButton>
            <PhoneButton>Accept</PhoneButton>
          </div>
        </PhoneCard>
      </PhoneSection>
    </PhoneFrame>
  );
}

function AgentCardScene({ values, ctx, bankName, theme }: SceneProps) {
  const h = num(values, 'agent_card.token_ttl_h', 24);
  return (
    <PhoneFrame {...FRAME} title="My agent card" showBack theme={theme}>
      <PhoneSection className="pb-3">
        <PhoneCard className="text-center">
          <div
            className="mx-auto flex size-14 items-center justify-center rounded-full text-[18px] font-bold"
            style={{ backgroundColor: FESS.avatar.background, color: FESS.avatar.foreground }}
          >
            {ctx.agent.first_name[0]}
            {ctx.agent.last_name[0]}
          </div>
          <div className="mt-2 text-[16px] font-semibold">
            {ctx.agent.first_name} {ctx.agent.last_name}
          </div>
          <div className={MUTED}>
            {ctx.agent.employee_number} · authorised for {bankName}
          </div>
          <div className="mx-auto mt-3 flex size-36 items-center justify-center rounded-lg border-2" style={{ borderColor: FESS.text, backgroundColor: FESS.bgPage }}>
            <QrCode className="size-28" strokeWidth={1.2} style={{ color: FESS.text }} />
          </div>
          <div className={cn('mt-2', MUTED)}>Merchants scan this to check you. The code renews every {h === 1 ? 'hour' : `${h} hours`}.</div>
        </PhoneCard>
      </PhoneSection>
    </PhoneFrame>
  );
}

// ── The preview panel ───────────────────────────────────────────────────────────────────────────
export function ConfigPhonePreview({
  values,
  section,
  strings,
  selectedProfile,
  onSelectProfile,
  bankName,
  className,
}: {
  values: JsonObject;
  section: SectionId;
  strings: Record<string, string>;
  selectedProfile: string | null;
  onSelectProfile: (key: string) => void;
  bankName: string | null;
  className?: string;
}) {
  const [manual, setManual] = useState<{ scene: Scene; forSection: SectionId } | null>(null);
  const scene = manual && manual.forSection === section ? manual.scene : sceneFor(section);
  const [installed, setInstalled] = useState('1.0.0');
  const [inside, setInside] = useState(true);
  const [usedPct, setUsedPct] = useState<number | null>(null);
  const [security, setSecurity] = useState<'normal' | 'mock' | 'root'>('mock');

  const ctx = samplePreviewContext();
  const theme: PhoneTheme = { primaryColor: str(values, 'theme.primary_color'), fontFamily: str(values, 'theme.font_family') };
  const profiles = getPath(values, 'geofence.profiles');
  const profileKeys = isPlainObject(profiles) ? Object.keys(profiles) : [];
  const fallbackProfile = str(values, 'geofence.default_profile') ?? profileKeys[0] ?? 'standalone';
  const profile = selectedProfile && profileKeys.includes(selectedProfile) ? selectedProfile : fallbackProfile;
  const threshold = num(values, 'storage.block_new_work_at_pct', 80);
  const pct = usedPct ?? threshold;
  const props: SceneProps = { values, strings, ctx, bankName: bankName ?? ctx.job.bank.name, theme };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="grid gap-2 rounded-lg border bg-card p-3">
        <div className="grid gap-1.5">
          <p className="text-sm font-semibold">Phone preview</p>
          <Select value={scene} onValueChange={(v) => setManual({ scene: v as Scene, forSection: section })}>
            <SelectTrigger className="h-9" aria-label="Screen shown">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCENES.map((sc) => (
                <SelectItem key={sc.id} value={sc.id}>
                  {sc.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {scene === 'location' ? (
          <div className="grid gap-2">
            <Select value={profile} onValueChange={onSelectProfile}>
              <SelectTrigger className="h-9" aria-label="Location type shown">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {profileKeys.map((p) => (
                  <SelectItem key={p} value={p}>
                    {profileLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ChoiceControl
              value={inside ? 'in' : 'out'}
              onChange={(v) => setInside(v === 'in')}
              options={[
                { value: 'in', label: 'Agent at the site' },
                { value: 'out', label: 'Agent away from the site' },
              ]}
            />
          </div>
        ) : null}
        {scene === 'updates' ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">FESS version on this phone</span>
            <Input value={installed} onChange={(e) => setInstalled(e.target.value)} className="h-9 w-24 font-mono" />
          </label>
        ) : null}
        {scene === 'sync' ? (
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Storage used on this phone: {pct}%</span>
            <input type="range" min={0} max={100} value={pct} onChange={(e) => setUsedPct(Number(e.target.value))} className="accent-primary" />
          </label>
        ) : null}
        {scene === 'security' ? (
          <ChoiceControl
            value={security}
            onChange={(v) => setSecurity(v as typeof security)}
            options={[
              { value: 'normal', label: 'Normal phone' },
              { value: 'mock', label: 'Fake location' },
              { value: 'root', label: 'Rooted or jailbroken' },
            ]}
          />
        ) : null}
      </div>
      <ScaleToFit naturalWidth={PHONE_OUTER_WIDTH}>
        {scene === 'availability' ? (
          <AvailabilityScene {...props} />
        ) : scene === 'updates' ? (
          <UpdatesScene {...props} installed={installed} />
        ) : scene === 'location' ? (
          <LocationScene {...props} profile={profile} inside={inside} />
        ) : scene === 'photos' ? (
          <PhotosScene {...props} />
        ) : scene === 'security' ? (
          <SecurityScene {...props} state={security} />
        ) : scene === 'sync' ? (
          <SyncScene {...props} usedPct={pct} />
        ) : scene === 'assignment' ? (
          <AssignmentScene {...props} />
        ) : scene === 'agent_card' ? (
          <AgentCardScene {...props} />
        ) : (
          <HomeScene {...props} />
        )}
      </ScaleToFit>
    </div>
  );
}
