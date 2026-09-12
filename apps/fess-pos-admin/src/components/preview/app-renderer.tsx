'use client';

// App preview (T3-23): the agent app from an `app` definition — bottom navigation from `navigation.items`, the home page,
// and every page type (docs/11 §7.1): view_page, list_page, flow, form_page and outcome_page, with in-phone navigation.
import {
  Bell,
  Circle,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  CloudUpload,
  House,
  IdCard,
  List,
  type LucideIcon,
  MapIcon,
  Menu,
  Plus,
  Search,
  Settings,
  User,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { AppDefinition, FlowDefinition, FormDefinition, PageDef } from '@/lib/engine';
import { cn } from '@/lib/utils';
import { FlowScreen } from './flow-renderer';
import { FormScreen } from './form-screen';
import { lenientParse } from './lenient-parse';
import { PhoneFrame, type PhoneTheme } from './phone-frame';
import { PhoneActionButton, PreviewNotice, UnknownElement } from './phone-widgets';
import { contentText, type PreviewTarget, PreviewEnvProvider, type RenderFrame, ruleBool, templateText, usePreviewEnv } from './preview-context';
import { humanise, readPathValue } from './preview-format';
import { JobListCard, statusChip, ViewByKey } from './view-renderer';

export interface FrameBase {
  theme?: PhoneTheme;
  width?: number;
  height?: number;
  caption?: ReactNode | false;
}

const ICONS: Record<string, LucideIcon> = {
  home: House,
  list: List,
  badge: IdCard,
  person: User,
  account: User,
  settings: Settings,
  map: MapIcon,
  add: Plus,
  search: Search,
  notifications: Bell,
  assignment: ClipboardList,
};

export function appPageList(app: AppDefinition): { id: string; label: string }[] {
  return Object.entries(app.pages).map(([id, p]) => ({ id, label: `${p.title ? p.title : humanise(id)} · ${humanise(p.type)}` }));
}

function OutcomeIcon({ outcome }: { outcome: PageDef['outcome'] }) {
  const [Icon, cls] = outcome === 'success' ? [CircleCheck, 'bg-emerald-50 text-emerald-600'] : outcome === 'saved' ? [CloudUpload, 'bg-sky-50 text-sky-600'] : [CircleAlert, 'bg-red-50 text-red-600'];
  return (
    <span className={cn('flex size-20 items-center justify-center rounded-full', cls)}>
      <Icon className="size-10" />
    </span>
  );
}

export function AppScreen({ app, frame, current, onCurrentChange }: { app: AppDefinition; frame: FrameBase; current: string | null; onCurrentChange: (pageId: string) => void }) {
  const env = usePreviewEnv();
  const [stack, setStack] = useState<string[]>([]);
  const [flowStep, setFlowStep] = useState<string | null>(null);
  const [formSection, setFormSection] = useState<string | null>(null);
  const pageId = current && app.pages[current] ? current : app.home in app.pages ? app.home : (Object.keys(app.pages)[0] ?? '');
  const page = app.pages[pageId];
  const nav = app.navigation && app.navigation.style !== 'none' ? app.navigation.items : [];
  const isRoot = pageId === app.home || nav.some((i) => i.page === pageId);

  const show = (id: string, push: boolean) => {
    if (push) setStack((s) => [...s, pageId]);
    setFlowStep(null);
    setFormSection(null);
    onCurrentChange(id);
  };
  const back = () => {
    const prev = stack[stack.length - 1] ?? app.home;
    setStack((s) => s.slice(0, -1));
    show(prev, false);
  };
  const home = () => {
    setStack([]);
    show(app.home, false);
  };
  const outcome = (kind: 'success' | 'saved' | 'failure', setKey: string | undefined) => {
    const id = app.outcome_sets?.[setKey ?? 'default']?.[kind];
    if (id && app.pages[id]) show(id, true);
    else home();
  };
  const navigate = (t: PreviewTarget) => {
    if ('page' in t) {
      if (app.pages[t.page]) show(t.page, true);
      return;
    }
    const id = Object.entries(app.pages).find(([, p]) => p.type === 'flow' && p.flow === t.flow)?.[0];
    if (id) show(id, true);
  };
  const scoped = { ...env, navigate };

  const fullScreen = page?.type === 'flow' || page?.type === 'form_page' || page?.type === 'outcome_page';
  const bottomNav =
    app.navigation?.style === 'bottom_tabs' && !fullScreen
      ? nav.map((i) => ({ label: i.label, icon: ICONS[i.icon ?? ''] ?? Circle, active: i.page === pageId, onSelect: () => (setStack([]), show(i.page, false)) }))
      : undefined;
  const drawer =
    app.navigation?.style === 'drawer' && !fullScreen ? (
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1.5">
        <Menu className="mr-1 size-4 shrink-0 text-slate-500" />
        {nav.map((i) => (
          <button key={i.page} type="button" onClick={() => show(i.page, false)} className={cn('shrink-0 rounded-full px-2.5 py-1 text-[13px]', i.page === pageId ? 'bg-[color-mix(in_srgb,var(--pp)_12%,white)] font-semibold text-[var(--pp)]' : 'text-slate-600')}>
            {i.label}
          </button>
        ))}
      </div>
    ) : null;
  const defaultTitle = page?.title ? templateText(page.title, env.data) : pageId === app.home ? (app.title ?? 'Home') : humanise(pageId);
  const renderFrame: RenderFrame = (parts) => (
    <PhoneFrame
      {...frame}
      title={parts.title === '' ? undefined : (parts.title ?? defaultTitle)}
      showBack={parts.showBack ?? !isRoot}
      onBack={parts.onBack ?? back}
      banner={
        <>
          {drawer}
          {parts.banner}
        </>
      }
      footer={parts.footer}
      overlay={parts.overlay}
      bottomNav={bottomNav}
    >
      {parts.body}
    </PhoneFrame>
  );

  let screen: ReactNode;
  if (!page) {
    screen = renderFrame({ body: <div className="p-3"><PreviewNotice>This app has no pages yet.</PreviewNotice></div> });
  } else if (page.type === 'view_page') {
    screen = renderFrame({
      body: (
        <div className="space-y-3 px-3 py-3">
          <ViewByKey viewKey={page.view} />
          {page.actions?.length ? (
            <div className="grid gap-2 pt-1">
              {page.actions.map((a, i) => (
                <PhoneActionButton key={a.label} variant={i === 0 ? 'primary' : 'outline'} onClick={() => navigate(a.target)}>
                  {templateText(a.label, env.data)}
                </PhoneActionButton>
              ))}
            </div>
          ) : null}
        </div>
      ),
    });
  } else if (page.type === 'list_page') {
    screen = renderFrame({ body: <ListPage page={page} /> });
  } else if (page.type === 'flow') {
    const doc = page.flow ? env.bundle.flows?.[page.flow] : undefined;
    const flow = doc ? (lenientParse('flow', doc).definition as unknown as FlowDefinition | null) : null;
    screen = flow ? (
      <FlowScreen
        key={pageId}
        flow={flow}
        renderFrame={renderFrame}
        title={page.title}
        current={flowStep}
        onCurrentChange={setFlowStep}
        onFinish={() => outcome('success', page.outcomes)}
        onExit={back}
      />
    ) : (
      renderFrame({ body: <div className="p-3"><PreviewNotice>Flow “{page.flow ?? '—'}” is not loaded in this preview.</PreviewNotice></div> })
    );
  } else if (page.type === 'form_page') {
    const doc = page.form ? env.bundle.forms?.[page.form] : undefined;
    const form = doc ? (lenientParse('form', doc).definition as unknown as FormDefinition | null) : null;
    screen = form ? (
      <FormScreen
        key={pageId}
        form={form}
        renderFrame={renderFrame}
        title={page.title}
        mode="scroll"
        current={formSection}
        onCurrentChange={setFormSection}
        sectionKeys={page.sections}
        onSubmitted={() => outcome('success', page.outcomes)}
        showBack
        onBack={back}
      />
    ) : (
      renderFrame({ body: <div className="p-3"><PreviewNotice>Form “{page.form ?? '—'}” is not loaded in this preview.</PreviewNotice></div> })
    );
  } else if (page.type === 'outcome_page') {
    const receiptPage = Object.entries(app.pages).find(([, p]) => p.type === 'view_page' && p.view === 'receipt')?.[0];
    screen = renderFrame({
      title: '',
      showBack: false,
      body: (
        <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center">
          <OutcomeIcon outcome={page.outcome} />
          <div className="text-[20px] font-semibold leading-tight">{templateText(page.title ?? humanise(page.outcome ?? ''), env.data)}</div>
          {page.message ? <p className="text-[15px] leading-snug text-slate-600">{templateText(page.message, env.data)}</p> : null}
          <div className="mt-2 grid w-full gap-2">
            {(page.buttons ?? []).map((b, i) => (
              <PhoneActionButton
                key={b.label}
                variant={i === 0 ? 'primary' : 'outline'}
                onClick={() => {
                  if (b.action === 'home') home();
                  else if (b.action === 'retry' || b.action === 'back') back();
                  else if (b.action === 'receipt' && receiptPage) show(receiptPage, true);
                  else if (b.action === 'receipt') home();
                  else if (b.target) navigate(b.target);
                }}
              >
                {templateText(b.label, env.data)}
              </PhoneActionButton>
            ))}
          </div>
          {page.auto_return_s ? <p className="text-[13px] text-slate-500">Returns home after {page.auto_return_s} s</p> : null}
        </div>
      ),
    });
  } else {
    screen = renderFrame({ body: <div className="p-3"><UnknownElement type={page.type} /></div> });
  }
  return <PreviewEnvProvider value={scoped}>{screen}</PreviewEnvProvider>;
}

function ListPage({ page }: { page: PageDef }) {
  const env = usePreviewEnv();
  const today = typeof env.data.today === 'string' ? env.data.today : null;
  let jobs = env.jobs.filter((job) => ruleBool(page.filter, { ...env.data, job }, true, today));
  if (page.sort) {
    const sort = page.sort;
    const key = (job: unknown) => {
      const v = readPathValue({ job }, sort) ?? readPathValue({ job }, sort.replace(/_start$/, '.start'));
      return typeof v === 'string' || typeof v === 'number' ? v : '';
    };
    jobs = [...jobs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (page.sort_direction === 'desc' ? -1 : 1));
  }
  if (page.source && page.source !== 'jobs') {
    return (
      <div className="p-3">
        <PreviewNotice>Lists of {humanise(page.source)} show the agent’s local records; the preview has sample jobs only.</PreviewNotice>
      </div>
    );
  }
  if (jobs.length === 0) {
    return <div className="m-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-[14px] text-slate-500">{contentText(env.strings, page.empty_content) || 'Nothing here yet.'}</div>;
  }
  const groups = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const g = page.group_by ? readPathValue({ job }, page.group_by) : '';
    const label = page.group_by?.endsWith('status') ? statusChip(g).label : typeof g === 'string' ? humanise(g) : String(g ?? '');
    groups.set(label, [...(groups.get(label) ?? []), job]);
  }
  return (
    <div className="space-y-3 px-3 py-3">
      {[...groups.entries()].map(([label, list]) => (
        <div key={label} className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {label ? <div className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{label}</div> : null}
          {list.map((job) => (
            <button key={job.id} type="button" className="block w-full text-left" onClick={() => page.on_tap && env.navigate?.(page.on_tap)}>
              <JobListCard viewKey={page.item_view} data={{ ...env.data, job }} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
