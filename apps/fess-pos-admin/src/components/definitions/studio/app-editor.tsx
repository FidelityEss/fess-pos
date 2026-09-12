'use client';

// App editor (docs/04 §3.6–3.7): the start page, the navigation tabs, every page (screen, list, form, flow, result)
// and the outcome sets that decide which result page a form or flow ends on — as a structured outline.
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { humanLabel, StructuredView } from '@/components/structured-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FORM_PAGE_ACTIONS, LIST_SOURCES, NAV_STYLES, OUTCOME_BUTTON_ACTIONS, OUTCOMES, PAGE_TYPES } from '@/lib/engine';
import { useIsAdvanced } from '@/lib/preferences';
import { cn, isPlainObject } from '@/lib/utils';
import { formSections } from './bundle';
import { ACTION_LABEL, enumLabel, NAV_ICONS, pageWording } from './catalogue-ui';
import { DocumentHeader } from './document-header';
import { asArr, asObj, asStr, KEY_PATTERN, moveItem, moveKey, type Obj, renameKey, setProp, uniqueKey, updateIn } from './doc';
import { ChoiceDialog, TargetField, targetText } from './pickers';
import { slotSentence } from './rule-english';
import {
  AdvancedJsonButton,
  CheckList,
  type EditorProps,
  Hint,
  IconAction,
  NumberField,
  ReorderButtons,
  Row,
  RuleLine,
  SelectField,
  SubHeading,
  TextField,
  type Update,
  useDragReorder,
  useStudio,
} from './shared';

/** Rename a page id everywhere it is referenced: home, navigation, outcome sets and every { page } target. */
function renamePage(doc: Obj, from: string, to: string): Obj {
  const swap = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(swap);
    if (isPlainObject(v)) {
      const out: Obj = {};
      for (const [k, x] of Object.entries(v)) out[k] = k === 'page' && x === from ? to : swap(x);
      return out;
    }
    return v;
  };
  const next = swap({ ...doc, pages: renameKey(asObj(doc.pages), from, to) }) as Obj;
  if (next.home === from) next.home = to;
  const sets = asObj(next.outcome_sets);
  if (Object.keys(sets).length) {
    next.outcome_sets = Object.fromEntries(Object.entries(sets).map(([n, s]) => [n, Object.fromEntries(Object.entries(asObj(s)).map(([o, p]) => [o, p === from ? to : p]))]));
  }
  return next;
}

function newPage(type: string, refs: ReturnType<typeof useStudio>['refs']): Obj {
  switch (type) {
    case 'view_page':
      return { type, view: refs.families.view[0]?.key ?? 'home' };
    case 'list_page':
      return { type, title: 'List', source: 'jobs', item_view: 'job_card' };
    case 'form_page':
      return { type, title: 'Form', form: refs.families.form[0]?.key ?? 'form', action: 'record.submit', subject: 'job', outcomes: 'default' };
    case 'flow':
      return { type, title: 'Journey', flow: refs.families.flow[0]?.key ?? 'flow', outcomes: 'default' };
    case 'outcome_page':
      return { type, outcome: 'success', title: 'Done', message: '', buttons: [{ label: 'Back to home', action: 'home' }] };
    default:
      return { type };
  }
}

function pageSummary(page: Obj, titleOf: (k: string) => string, fam: (kind: 'view' | 'form' | 'flow', k: string) => string): string {
  switch (page.type) {
    case 'view_page':
      return `Shows the screen “${fam('view', asStr(page.view))}”${asArr(page.actions).length ? ` · ${asArr(page.actions).length} button${asArr(page.actions).length === 1 ? '' : 's'}` : ''}`;
    case 'list_page':
      return `Lists ${enumLabel(asStr(page.source)).toLowerCase()}${isPlainObject(page.filter) ? ' (filtered)' : ''}${page.on_tap ? ` · tap ${targetText(page.on_tap, titleOf)}` : ''}`;
    case 'form_page':
      return `Form “${fam('form', asStr(page.form))}” → ${(ACTION_LABEL[asStr(page.action)] ?? asStr(page.action)).toLowerCase()}`;
    case 'flow':
      return `Runs the flow “${fam('flow', asStr(page.flow))}”`;
    case 'outcome_page':
      return `${enumLabel(asStr(page.outcome))} · ${asStr(page.message).slice(0, 70)}`;
    default:
      return '';
  }
}

/** A list of { label, target } buttons (view page actions) or { label, action, target } (outcome buttons). */
function ButtonsEditor({ path, items, update, withAction, pages }: { path: (string | number)[]; items: Obj[]; update: Update; withAction: boolean; pages: { key: string; title: string }[] }) {
  const { readOnly, refs } = useStudio();
  const flows = refs.families.flow.map((f) => ({ key: f.key, title: f.title }));
  const setAt = (i: number, k: string, v: unknown) => update((d) => setProp(d, [...path, i], k, v) as Obj);
  const setList = (fn: (l: unknown[]) => unknown[]) => update((d) => updateIn(d, path, (cur) => fn([...asArr(cur)])) as Obj);
  return (
    <div className="grid gap-2">
      {items.map((b, i) => (
        <div key={i} className="grid gap-3 rounded-md border bg-card p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <TextField label="Button label" value={asStr(b.label)} onChange={(v) => setAt(i, 'label', v)} />
          {withAction ? (
            <div className="grid gap-3">
              <SelectField label="Does" value={asStr(b.action) || undefined} onChange={(v) => setAt(i, 'action', v)} options={OUTCOME_BUTTON_ACTIONS.map((a) => ({ value: a, label: enumLabel(a) }))} />
              {b.action === 'page' || b.action === 'start_flow' ? <TargetField label="Which" value={b.target} onChange={(v) => setAt(i, 'target', v)} pages={pages} flows={flows} allowNone={false} /> : null}
            </div>
          ) : (
            <TargetField label="Opens" value={b.target} onChange={(v) => setAt(i, 'target', v)} pages={pages} flows={flows} allowNone={false} />
          )}
          {!readOnly ? (
            <div className="flex items-center">
              <ReorderButtons index={i} count={items.length} onMove={(from, to) => update((d) => moveItem(d, path, from, to) as Obj)} noun="button" />
              <IconAction label="Remove button" destructive onClick={() => setList((l) => l.filter((_, j) => j !== i))}>
                <Trash2 />
              </IconAction>
            </div>
          ) : null}
        </div>
      ))}
      {!readOnly ? (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => setList((l) => [...l, withAction ? { label: 'Back to home', action: 'home' } : { label: 'Open', target: { page: pages[0]?.key ?? 'home' } }])}>
            <Plus /> Add a button
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PageIdEditor({ id, taken, onRename }: { id: string; taken: string[]; onRename: (to: string) => void }) {
  const [draft, setDraft] = useState(id);
  const problem = draft === id ? null : !KEY_PATTERN.test(draft) ? 'Lower-case letters, digits and _' : taken.includes(draft) ? 'Already used' : null;
  return (
    <Row label="Page id" hint={problem ?? 'Renaming updates the start page, navigation, outcome sets and every button that opens it.'}>
      <div className="flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value.trim())} className="font-mono" aria-invalid={!!problem} />
        <Button type="button" variant="outline" disabled={draft === id || !!problem} onClick={() => onRename(draft)}>
          Rename
        </Button>
      </div>
    </Row>
  );
}

function PageInspector({ id, page, props, pages, setNames }: { id: string; page: Obj; props: EditorProps; pages: { key: string; title: string }[]; setNames: string[] }) {
  const { update, onSelect } = props;
  const advanced = useIsAdvanced();
  const { refs, readOnly } = useStudio();
  const path = ['pages', id];
  const type = asStr(page.type);
  const spec = PAGE_TYPES[type];
  const set = (k: string, v: unknown) => update((d) => setProp(d, path, k, v) as Obj);
  const flows = refs.families.flow.map((f) => ({ key: f.key, title: f.title }));
  const viewOptions = refs.families.view.map((v) => ({ value: v.key, label: v.title }));
  const formKey = asStr(page.form);
  const sections = formSections(refs.bundle.forms?.[formKey]);
  const has = (p: string) => !!spec?.props[p];

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Title at the top of the page" value={asStr(page.title)} onChange={(v) => set('title', v)} placeholder={humanLabel(id)} />
        {advanced && !readOnly ? (
          <PageIdEditor
            id={id}
            taken={pages.map((p) => p.key)}
            onRename={(to) => {
              update((d) => renamePage(d, id, to));
              onSelect(`pages/${to}`);
            }}
          />
        ) : null}
      </div>
      {has('view') ? <SelectField label="Screen shown" value={asStr(page.view) || undefined} onChange={(v) => set('view', v)} options={viewOptions} /> : null}
      {has('actions') ? (
        <div className="grid gap-2">
          <SubHeading>Buttons at the bottom</SubHeading>
          <ButtonsEditor path={[...path, 'actions']} items={asArr(page.actions).map(asObj)} update={update} withAction={false} pages={pages} />
        </div>
      ) : null}
      {type === 'list_page' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Lists" value={asStr(page.source) || undefined} onChange={(v) => set('source', v)} options={LIST_SOURCES.map((s) => ({ value: s, label: enumLabel(s) }))} />
          <SelectField label="Each item looks like" value={asStr(page.item_view) || undefined} onChange={(v) => set('item_view', v)} options={viewOptions} />
          <Row label="Which records" className="md:col-span-2">
            {isPlainObject(page.filter) ? (
              <RuleLine sentence={slotSentence('filter', page.filter)} rule={page.filter} onChange={(v) => set('filter', v)} onRemove={() => set('filter', undefined)} removeLabel="Show everything" />
            ) : (
              <span className="text-sm">Everything</span>
            )}
          </Row>
          <TextField label="Sort by" value={asStr(page.sort)} onChange={(v) => set('sort', v)} mono placeholder="job.scheduled_start" />
          <SelectField label="Order" value={asStr(page.sort_direction) || undefined} onChange={(v) => set('sort_direction', v)} unsetLabel="Default" options={['asc', 'desc'].map((d) => ({ value: d, label: enumLabel(d) }))} />
          <TargetField label="Tapping an item" value={page.on_tap} onChange={(v) => set('on_tap', v)} pages={pages} flows={flows} />
          <SelectField
            label="Text when the list is empty"
            value={asStr(page.empty_content) || undefined}
            onChange={(v) => set('empty_content', v)}
            unsetLabel="None"
            options={Object.entries(refs.bundle.strings ?? {}).map(([k, t]) => ({ value: k, label: t.length > 60 ? `${t.slice(0, 60)}…` : t }))}
          />
          {advanced ? <TextField label="Group by" value={asStr(page.group_by)} onChange={(v) => set('group_by', v)} mono /> : null}
        </div>
      ) : null}
      {type === 'form_page' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Form" value={formKey || undefined} onChange={(v) => set('form', v)} options={refs.families.form.map((f) => ({ value: f.key, label: f.title }))} />
          <SelectField label="Submitting it will" value={asStr(page.action) || undefined} onChange={(v) => set('action', v)} options={FORM_PAGE_ACTIONS.map((a) => ({ value: a, label: ACTION_LABEL[a] ?? a }))} />
          <SelectField label="About" value={asStr(page.subject) || undefined} onChange={(v) => set('subject', v)} unsetLabel="Default" options={['job', 'agent', 'none'].map((s) => ({ value: s, label: s === 'none' ? 'Nothing in particular' : enumLabel(s) }))} />
          <SelectField label="Result pages" value={asStr(page.outcomes) || undefined} onChange={(v) => set('outcomes', v)} options={setNames.map((n) => ({ value: n, label: humanLabel(n) }))} />
          {sections.length ? (
            <CheckList
              label="Sections shown"
              hint="None ticked shows the whole form."
              values={asArr(page.sections).map(String)}
              onChange={(v) => set('sections', v.length ? v : undefined)}
              options={sections.map((s) => ({ value: s.key, label: s.title }))}
            />
          ) : null}
        </div>
      ) : null}
      {type === 'flow' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Flow" value={asStr(page.flow) || undefined} onChange={(v) => set('flow', v)} options={refs.families.flow.map((f) => ({ value: f.key, label: f.title }))} />
          <SelectField label="Result pages" value={asStr(page.outcomes) || undefined} onChange={(v) => set('outcomes', v)} options={setNames.map((n) => ({ value: n, label: humanLabel(n) }))} />
        </div>
      ) : null}
      {type === 'outcome_page' ? (
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-3">
            <SelectField label="Result" value={asStr(page.outcome) || undefined} onChange={(v) => set('outcome', v)} options={OUTCOMES.map((o) => ({ value: o, label: enumLabel(o) }))} />
            <TextField label="Icon" value={asStr(page.icon)} onChange={(v) => set('icon', v)} mono placeholder="check_circle" />
            <NumberField label="Go back automatically after (seconds)" value={typeof page.auto_return_s === 'number' ? page.auto_return_s : undefined} onChange={(v) => set('auto_return_s', v)} min={0} max={60} step={1} />
          </div>
          <TextField label="Message" value={asStr(page.message)} onChange={(v) => set('message', v)} multiline rows={3} />
          <SubHeading>Buttons</SubHeading>
          <ButtonsEditor path={[...path, 'buttons']} items={asArr(page.buttons).map(asObj)} update={update} withAction pages={pages} />
        </div>
      ) : null}
      {!spec ? (
        <Row label="Settings">
          <StructuredView value={page} className="rounded-md border bg-card p-2" />
        </Row>
      ) : null}
      <AdvancedJsonButton value={page} onApply={(v) => update((d) => updateIn(d, path, () => asObj(v)) as Obj)} label="Edit this page as JSON" />
    </div>
  );
}

export function AppEditor(props: EditorProps) {
  const { doc, update, selected, onSelect } = props;
  const advanced = useIsAdvanced();
  const { readOnly, refs } = useStudio();
  const [adding, setAdding] = useState(false);
  const pagesObj = asObj(doc.pages);
  const pageIds = Object.keys(pagesObj);
  const pages = pageIds.map((id) => ({ key: id, title: asStr(asObj(pagesObj[id]).title) || humanLabel(id) }));
  const titleOf = (k: string) => pages.find((p) => p.key === k)?.title ?? k;
  const famTitle = (kind: 'view' | 'form' | 'flow', k: string) => refs.families[kind].find((f) => f.key === k)?.title ?? k;
  const nav = asObj(doc.navigation);
  const navItems = asArr(nav.items).map(asObj);
  const sets = asObj(doc.outcome_sets);
  const setNames = Object.keys(sets);
  const navPages = new Set(navItems.map((n) => asStr(n.page)));
  const navDrag = useDragReorder('nav', (from, to) => update((d) => moveItem(d, ['navigation', 'items'], from, to) as Obj));
  const pageDrag = useDragReorder('pages', (from, to) => movePage(from, to));

  function movePage(from: number, to: number) {
    const id = pageIds[from];
    if (id === undefined || to < 0 || to >= pageIds.length) return;
    update((d) => ({ ...d, pages: moveKey(asObj(d.pages), id, to) }));
  }

  function removePage(id: string) {
    const old = pagesObj[id];
    const at = pageIds.indexOf(id);
    update((d) => {
      const p = { ...asObj(d.pages) };
      delete p[id];
      return { ...d, pages: p };
    });
    onSelect(null);
    toast(`Removed page “${titleOf(id)}”`, {
      action: { label: 'Undo', onClick: () => update((d) => ({ ...d, pages: moveKey({ ...asObj(d.pages), [id]: old }, id, at) })) },
    });
  }

  const outcomePages = (o: string) => pages.filter((p) => asObj(pagesObj[p.key]).type === 'outcome_page' && asObj(pagesObj[p.key]).outcome === o);

  return (
    <div className="grid gap-4">
      <DocumentHeader doc={doc} update={update}>
        <SelectField
          label="Start page"
          hint="What the agent sees first when they open POS."
          value={asStr(doc.home) || undefined}
          onChange={(v) => update((d) => setProp(d, [], 'home', v) as Obj)}
          options={pages.map((p) => ({ value: p.key, label: p.title }))}
          className="md:max-w-md"
        />
      </DocumentHeader>

      <Card className={cn(selected === 'navigation' && 'border-primary ring-2 ring-primary/25')}>
        <CardContent className="grid gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="text-left" onClick={() => onSelect(selected === 'navigation' ? null : 'navigation')}>
              <h3 className="text-base font-semibold">Navigation</h3>
              <Hint>The tabs the agent uses to move between the main pages.</Hint>
            </button>
            {doc.navigation !== undefined ? (
              <SelectField
                label="Style"
                value={asStr(nav.style) || undefined}
                onChange={(v) => update((d) => setProp(d, ['navigation'], 'style', v ?? 'bottom_tabs') as Obj)}
                options={NAV_STYLES.map((s) => ({ value: s, label: enumLabel(s) }))}
                className="w-56"
              />
            ) : null}
          </div>
          {doc.navigation === undefined ? (
            !readOnly ? (
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => update((d) => ({ ...d, navigation: { style: 'bottom_tabs', items: [] } }))}>
                  <Plus /> Add navigation
                </Button>
              </div>
            ) : (
              <Hint>No navigation.</Hint>
            )
          ) : (
            <ol className="grid gap-2">
              {navItems.map((n, i) => (
                <li key={i} {...navDrag.target(i)} className={cn('grid items-end gap-3 rounded-md border bg-card p-3 md:grid-cols-[auto_minmax(0,1fr)_10rem_minmax(0,1fr)_auto]', navDrag.over === i && 'border-primary ring-2 ring-primary/30')}>
                  <span className="hidden self-center md:flex">{navDrag.handle(i)}</span>
                  <TextField label={`Tab ${i + 1} label`} value={asStr(n.label)} onChange={(v) => update((d) => setProp(d, ['navigation', 'items', i], 'label', v, false) as Obj)} />
                  <SelectField label="Icon" value={asStr(n.icon) || undefined} onChange={(v) => update((d) => setProp(d, ['navigation', 'items', i], 'icon', v) as Obj)} unsetLabel="None" options={NAV_ICONS.map((ic) => ({ value: ic, label: humanLabel(ic) }))} />
                  <SelectField label="Opens" value={asStr(n.page) || undefined} onChange={(v) => update((d) => setProp(d, ['navigation', 'items', i], 'page', v ?? '') as Obj)} options={pages.map((p) => ({ value: p.key, label: p.title }))} />
                  {!readOnly ? (
                    <div className="flex items-center">
                      <ReorderButtons index={i} count={navItems.length} onMove={(from, to) => update((d) => moveItem(d, ['navigation', 'items'], from, to) as Obj)} noun="tab" />
                      <IconAction label="Remove tab" destructive onClick={() => update((d) => updateIn(d, ['navigation', 'items'], (cur) => asArr(cur).filter((_, j) => j !== i)) as Obj)}>
                        <Trash2 />
                      </IconAction>
                    </div>
                  ) : null}
                </li>
              ))}
              {!readOnly ? (
                <li>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => update((d) => updateIn(d, ['navigation', 'items'], (cur) => [...asArr(cur), { label: 'New tab', icon: 'home', page: pageIds[0] ?? 'home' }]) as Obj)}
                  >
                    <Plus /> Add a tab
                  </Button>
                </li>
              ) : null}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 p-4">
          <div>
            <h3 className="text-base font-semibold">Pages</h3>
            <Hint>Every page the app can show. Click a page to change it.</Hint>
          </div>
          <ol className="grid gap-2">
            {pageIds.map((id, i) => {
              const page = asObj(pagesObj[id]);
              const w = pageWording(asStr(page.type));
              const pk = `pages/${id}`;
              const isSel = selected === pk;
              return (
                <li key={id} {...pageDrag.target(i)} className={cn('rounded-lg border bg-card', isSel && 'border-primary ring-2 ring-primary/25', pageDrag.over === i && 'border-primary ring-2 ring-primary/30')}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={isSel}
                    onClick={() => onSelect(isSel ? null : pk)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onSelect(isSel ? null : pk);
                      }
                    }}
                    className="flex cursor-pointer items-start gap-2 rounded-lg p-2.5 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {pageDrag.handle(i)}
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                      <w.icon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-medium">{asStr(page.title) || humanLabel(id)}</span>
                        <span className="text-sm text-muted-foreground">{w.name}</span>
                        {doc.home === id ? <Badge tone="success">Start page</Badge> : null}
                        {navPages.has(id) ? <Badge tone="accent">In navigation</Badge> : null}
                        {advanced ? <code className="text-xs text-muted-foreground">{id}</code> : null}
                      </div>
                      <p className="text-sm text-muted-foreground">{pageSummary(page, titleOf, famTitle) || w.description}</p>
                    </div>
                    {!readOnly ? (
                      <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                        <ReorderButtons index={i} count={pageIds.length} onMove={movePage} noun="page" />
                        <IconAction label="Remove page" destructive disabled={doc.home === id} onClick={() => removePage(id)}>
                          <Trash2 />
                        </IconAction>
                      </div>
                    ) : null}
                  </div>
                  {isSel ? (
                    <div className="border-t bg-slate-50/70 p-4">
                      <PageInspector id={id} page={page} props={props} pages={pages} setNames={setNames} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {!readOnly ? (
            <div>
              <Button type="button" variant="outline" onClick={() => setAdding(true)}>
                <Plus /> Add a page
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 p-4">
          <div>
            <h3 className="text-base font-semibold">Result pages for forms and flows</h3>
            <Hint>Every form and flow ends on one of three results: confirmed by the server, saved on the phone (offline), or could not be completed.</Hint>
          </div>
          {setNames.map((name) => (
            <div key={name} className="grid gap-3 rounded-md border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{humanLabel(name)} set</span>
                {advanced && !readOnly ? (
                  <IconAction
                    label="Remove set"
                    destructive
                    onClick={() =>
                      update((d) => {
                        const s = { ...asObj(d.outcome_sets) };
                        delete s[name];
                        return { ...d, outcome_sets: s };
                      })
                    }
                  >
                    <Trash2 />
                  </IconAction>
                ) : null}
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {OUTCOMES.map((o) => (
                  <SelectField
                    key={o}
                    label={o === 'success' ? 'Confirmed by the server' : enumLabel(o)}
                    value={asStr(asObj(sets[name])[o]) || undefined}
                    onChange={(v) => update((d) => setProp(d, ['outcome_sets', name], o, v ?? '') as Obj)}
                    options={(outcomePages(o).length ? outcomePages(o) : pages).map((p) => ({ value: p.key, label: p.title }))}
                  />
                ))}
              </div>
            </div>
          ))}
          {advanced && !readOnly ? (
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  update((d) => {
                    const s = asObj(d.outcome_sets);
                    const n = uniqueKey(Object.keys(s).length ? 'set' : 'default', Object.keys(s));
                    return { ...d, outcome_sets: { ...s, [n]: { success: outcomePages('success')[0]?.key ?? '', saved: outcomePages('saved')[0]?.key ?? '', failure: outcomePages('failure')[0]?.key ?? '' } } };
                  })
                }
              >
                <Plus /> Add a result set
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ChoiceDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add a page"
        choices={Object.keys(PAGE_TYPES).map((t) => ({ value: t, ...pageWording(t) }))}
        onPick={(t) => {
          const id = uniqueKey(t === 'outcome_page' ? 'outcome' : t.replace(/_page$/, ''), pageIds);
          update((d) => ({ ...d, pages: { ...asObj(d.pages), [id]: newPage(t, refs) } }));
          onSelect(`pages/${id}`);
        }}
      />
    </div>
  );
}
