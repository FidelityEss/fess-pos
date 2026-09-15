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
import { FESS } from '@/lib/brand';
import type { AppDefinition, FlowDefinition, FormDefinition, PageDef } from '@/lib/engine';
import { cn } from '@/lib/utils';
import { FlowScreen } from './flow-renderer';
import { FormScreen } from './form-screen';
import { lenientParse } from './lenient-parse';
import { PhoneFrame, type PhoneTheme } from './phone-frame';
import { PAGE_X, PP_TINT_BG, toneColors, typeStyle } from './phone-style';
import { PhoneActionButton, PreviewNotice, StickyFooter, UnknownElement } from './phone-widgets';
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

/** The outcome's icon in a white circle on the green hero, in its tone: success green, saved gold, failure red. */
function OutcomeIcon({ outcome }: { outcome: PageDef['outcome'] }) {
  const Icon = outcome === 'success' ? CircleCheck : outcome === 'saved' ? CloudUpload : CircleAlert;
  const tone = outcome === 'success' ? 'success' : outcome === 'failure' ? 'danger' : 'accent';
  return (
    <span className="flex items-center justify-center rounded-full p-4" style={{ backgroundColor: FESS.page.background, color: toneColors(tone).foreground }}>
      <Icon className="size-10" strokeWidth={2.25} />
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
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[color:var(--ph-divider)] bg-[color:var(--ph-page)] px-2 py-1.5">
        <Menu className="mr-1 size-4 shrink-0 text-[color:var(--ph-body)]" />
        {nav.map((i) => (
          <button
            key={i.page}
            type="button"
            onClick={() => show(i.page, false)}
            className={cn('shrink-0 rounded-[var(--ph-pill)] px-2.5 py-1 text-[13px]', i.page === pageId ? cn(PP_TINT_BG, 'font-semibold text-[var(--pp)]') : 'font-medium text-[color:var(--ph-body)]')}
          >
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
  const padded = cn(PAGE_X, 'py-4');
  if (!page) {
    screen = renderFrame({ body: <div className={padded}><PreviewNotice>This app has no pages yet.</PreviewNotice></div> });
  } else if (page.type === 'view_page') {
    // The page's actions sit at its foot, on white under a hairline, as the module's job page.
    screen = renderFrame({
      body: (
        <div className={padded}>
          <ViewByKey viewKey={page.view} />
        </div>
      ),
      footer: page.actions?.length ? (
        <StickyFooter>
          <div className="grid w-full gap-3">
            {page.actions.map((a, i) => (
              <PhoneActionButton key={a.label} variant={i === 0 ? 'primary' : 'outline'} onClick={() => navigate(a.target)}>
                {templateText(a.label, env.data)}
              </PhoneActionButton>
            ))}
          </div>
        </StickyFooter>
      ) : undefined,
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
      renderFrame({ body: <div className={padded}><PreviewNotice>The visit steps “{page.flow ?? '—'}” can’t be shown in this preview.</PreviewNotice></div> })
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
      renderFrame({ body: <div className={padded}><PreviewNotice>The questions “{page.form ?? '—'}” can’t be shown in this preview.</PreviewNotice></div> })
    );
  } else if (page.type === 'outcome_page') {
    const receiptPage = Object.entries(app.pages).find(([, p]) => p.type === 'view_page' && p.view === 'receipt')?.[0];
    // As FESS's confirmation screens: the green runs on from the top into the icon (in a white circle), the title and the
    // message; the choices sit on white below. Home is the filled button, the others outlined (as the module).
    screen = renderFrame({
      title: '',
      showBack: false,
      body: (
        <div className="flex min-h-full flex-col">
          <div className={cn('flex flex-col items-center pb-10 pt-8 text-center', PAGE_X)} style={{ backgroundColor: 'var(--pp)', color: FESS.textOnPrimary }}>
            <OutcomeIcon outcome={page.outcome} />
            <div className="mt-5 leading-tight" style={{ fontSize: FESS.type.headline.size, fontWeight: FESS.type.title.weight }}>
              {templateText(page.title ?? humanise(page.outcome ?? ''), env.data)}
            </div>
            {page.message ? (
              <p className="mt-2 leading-snug" style={typeStyle('bodyRegular')}>
                {templateText(page.message, env.data)}
              </p>
            ) : null}
          </div>
          <div className={cn('grid gap-3 py-6', PAGE_X)}>
            {(page.buttons ?? []).map((b) => (
              <PhoneActionButton
                key={b.label}
                variant={b.action === 'home' ? 'primary' : 'outline'}
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
            {page.auto_return_s ? (
              <p className="text-center text-[color:var(--ph-body)]" style={typeStyle('caption')}>
                Returns home after {page.auto_return_s} s
              </p>
            ) : null}
          </div>
        </div>
      ),
    });
  } else {
    screen = renderFrame({ body: <div className={padded}><UnknownElement type={page.type} /></div> });
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
      <div className={cn(PAGE_X, 'py-4')}>
        <PreviewNotice>This list shows the {humanise(page.source).toLowerCase()} saved on the agent’s phone. The preview only has sample jobs.</PreviewNotice>
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div className={cn(PAGE_X, 'py-8 text-center text-[color:var(--ph-body)]')} style={typeStyle('body')}>
        {contentText(env.strings, page.empty_content) || 'Nothing here yet.'}
      </div>
    );
  }
  const groups = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const g = page.group_by ? readPathValue({ job }, page.group_by) : '';
    const label = page.group_by?.endsWith('status') ? statusChip(g).label : typeof g === 'string' ? humanise(g) : String(g ?? '');
    groups.set(label, [...(groups.get(label) ?? []), job]);
  }
  // Flat rows edge to edge, each group under its heading and a hairline (the module's job list).
  return (
    <div className="pb-4 pt-4">
      {[...groups.entries()].map(([label, list], g) => (
        <div key={label} className={cn('grid grid-cols-[minmax(0,1fr)]', g > 0 && 'mt-4')}>
          {label ? (
            <div className={cn(PAGE_X, 'pb-2 text-[color:var(--ph-body)]')} style={typeStyle('body')}>
              {label}
            </div>
          ) : null}
          <div className="border-t border-[color:var(--ph-divider)]">
            {list.map((job) => (
              <button key={job.id} type="button" className="block w-full cursor-pointer text-left" onClick={() => page.on_tap && env.navigate?.(page.on_tap)}>
                <JobListCard viewKey={page.item_view} data={{ ...env.data, job }} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
