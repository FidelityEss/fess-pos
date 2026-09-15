'use client';

// Form editor: sections as cards, questions as rows (type icon, label, badges, rule sentences) with the question's
// settings opening underneath the selected row. Groups nest their own question list. Also exports FieldList for the
// job schema editor (attributes are questions too).
import { ChevronDown, ChevronRight, Copy, FolderInput, MoreHorizontal, Plus, Settings2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Details } from '@/components/details';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { COMPONENTS, type ComponentSpec } from '@/lib/engine';
import { useIsAdvanced } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { componentWording } from './catalogue-ui';
import { ComponentPicker } from './component-picker';
import { DocumentHeader } from './document-header';
import {
  allFieldKeys,
  asArr,
  asObj,
  asStr,
  getIn,
  insertAt,
  isRule,
  moveItem,
  type Obj,
  type Path,
  pathKey,
  rekeyCopy,
  remapSelection,
  removeAt,
  setProp,
  toKey,
  uniqueKey,
  updateIn,
} from './doc';
import { FieldInspector } from './field-inspector';
import { type RuleVocabulary, slotSentence } from './rule-english';
import { AdvancedJsonButton, type EditorProps, Hint, IconAction, JsonPartEditor, ReorderButtons, RuleLine, SelectField, SwitchField, TextField, type Update, useDragReorder, useStudio } from './shared';
import { buildVocab } from './vocab';

type Mode = 'form' | 'job_schema';

interface ListCtx {
  mode: Mode;
  vocab: RuleVocabulary;
  takenKeys: string[];
  orderedKeys: string[];
  fieldChoices: { value: string; label: string }[];
  sections: { index: number; title: string }[];
  allow?: (spec: ComponentSpec) => boolean;
}

function fieldLabelOf(f: Obj): string {
  if (typeof f.label === 'string' && f.label) return f.label;
  if (typeof f.text === 'string' && f.text) return f.text.length > 80 ? `${f.text.slice(0, 80)}…` : f.text;
  return '';
}

function FieldBadges({ field }: { field: Obj }) {
  const spec = COMPONENTS[asStr(field.type)];
  const out: React.ReactNode[] = [];
  if (field.required === true) out.push(<Badge key="req" tone="neutral">Required</Badge>);
  else if (isRule(field.required)) out.push(<Badge key="req" tone="progress">Required sometimes</Badge>);
  if (isRule(field.visible)) out.push(<Badge key="vis" tone="progress">Shown sometimes</Badge>);
  if (field.visible === false) out.push(<Badge key="vis" tone="muted">Hidden</Badge>);
  if (isRule(field.risk_indicator)) out.push(<Badge key="risk" tone="warning">Risk flag</Badge>);
  if (field.read_only === true || field.value !== undefined || spec?.category === 'computed') out.push(<Badge key="auto" tone="info">Automatic</Badge>);
  const checks = asArr(field.validate).length;
  if (checks) out.push(<Badge key="val" tone="neutral">{checks === 1 ? '1 check' : `${checks} checks`}</Badge>);
  const src = asObj(field.options_source);
  if (src.type === 'reason_codes') out.push(<Badge key="src" tone="accent">Reasons</Badge>);
  if (src.type === 'lookup_list') out.push(<Badge key="src" tone="accent">Drop-down list</Badge>);
  const p = asObj(field.props);
  if (field.type === 'photo') {
    const min = typeof p.min_count === 'number' ? p.min_count : isRule(p.min_count) ? 'varies' : 0;
    const max = typeof p.max_count === 'number' ? p.max_count : null;
    out.push(<Badge key="ph" tone="neutral">{`Photos ${min}${max !== null ? `–${max}` : '+'}`}</Badge>);
  }
  return <>{out}</>;
}

function FieldRowCard({
  arrayPath,
  index,
  count,
  field,
  doc,
  update,
  selected,
  onSelect,
  ctx,
  drag,
}: {
  arrayPath: Path;
  index: number;
  count: number;
  field: Obj;
  doc: Obj;
  update: Update;
  selected: string | null;
  onSelect: (p: string | null) => void;
  ctx: ListCtx;
  drag: ReturnType<typeof useDragReorder>;
}) {
  const advanced = useIsAdvanced();
  const { readOnly, fresh } = useStudio();
  const path = [...arrayPath, index];
  const pk = pathKey(path);
  const isSelected = selected === pk;
  const type = asStr(field.type);
  const spec = COMPONENTS[type];
  const w = componentWording(type);
  const label = fieldLabelOf(field);
  const key = asStr(field.key);
  const topLevelFormField = ctx.mode === 'form' && arrayPath.length === 3 && arrayPath[0] === 'sections';
  const currentSection = topLevelFormField ? (arrayPath[1] as number) : -1;
  const root = ctx.mode === 'job_schema' ? 'attributes' : 'sections';

  function duplicate() {
    update((d) => {
      const taken = new Set(allFieldKeys(d, root));
      const { field: copy, keys } = rekeyCopy(asObj(getIn(d, path)), taken);
      keys.forEach((k) => fresh.add(k));
      if (typeof copy.label === 'string') copy.label = `${copy.label} (copy)`;
      return insertAt(d, arrayPath, index + 1, copy) as Obj;
    });
    onSelect(pathKey([...arrayPath, index + 1]));
  }

  function remove() {
    const removed = field;
    update((d) => removeAt(d, arrayPath, index) as Obj);
    if (selected?.startsWith(`${pathKey(arrayPath)}/`)) onSelect(null);
    toast(`Removed “${label || w.name}”`, { action: { label: 'Undo', onClick: () => update((d) => insertAt(d, arrayPath, index, removed) as Obj) } });
  }

  function moveToSection(target: number) {
    let newIndex = 0;
    update((d) => {
      const f = getIn(d, path);
      const without = removeAt(d, arrayPath, index);
      newIndex = asArr(getIn(without, ['sections', target, 'fields'])).length;
      return insertAt(without, ['sections', target, 'fields'], newIndex, f) as Obj;
    });
    onSelect(pathKey(['sections', target, 'fields', newIndex]));
  }

  const flatIdx = ctx.orderedKeys.indexOf(key);
  const previousKey = flatIdx > 0 ? ctx.orderedKeys[flatIdx - 1] : undefined;

  return (
    <li
      {...drag.target(index)}
      className={cn(
        'rounded-lg border bg-card transition-colors',
        isSelected && 'border-primary ring-2 ring-primary/25',
        drag.over === index && 'border-primary ring-2 ring-primary/30',
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isSelected}
        onClick={() => onSelect(isSelected ? null : pk)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(isSelected ? null : pk);
          }
        }}
        className="flex cursor-pointer items-start gap-2 rounded-lg p-2.5 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {drag.handle(index)}
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground" title={w.name}>
          <w.icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn('text-base font-medium', !label && 'italic text-muted-foreground')}>{label || w.name}</span>
            <FieldBadges field={field} />
          </div>
          <div className="text-sm text-muted-foreground">
            {w.name}
            {advanced ? <code className="ml-2 text-xs">{key}</code> : null}
          </div>
          {isRule(field.visible) ? <div className="mt-0.5 text-sm text-violet-800">{slotSentence('visible', field.visible, ctx.vocab)}</div> : null}
          {isRule(field.required) ? <div className="mt-0.5 text-sm text-violet-800">{slotSentence('required', field.required, ctx.vocab)}</div> : null}
        </div>
        {!readOnly ? (
          <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
            <ReorderButtons index={index} count={count} noun="question" onMove={(from, to) => {
              update((d) => moveItem(d, arrayPath, from, to) as Obj);
              onSelect(remapSelection(selected, arrayPath, from, to));
            }} />
            <IconAction label="Duplicate" onClick={duplicate}>
              <Copy />
            </IconAction>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="More actions" title="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                {topLevelFormField && ctx.sections.length > 1 ? (
                  <>
                    <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
                      <FolderInput className="size-4" /> Move to section
                    </DropdownMenuLabel>
                    {ctx.sections
                      .filter((s) => s.index !== currentSection)
                      .map((s) => (
                        <DropdownMenuItem key={s.index} onSelect={() => moveToSection(s.index)}>
                          {s.title}
                        </DropdownMenuItem>
                      ))}
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <DropdownMenuItem destructive onSelect={remove}>
                  <Trash2 /> Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
      {isSelected ? (
        <div className="border-t p-4">
          <FieldInspector
            path={path}
            field={field}
            update={update}
            vocab={ctx.vocab}
            mode={ctx.mode}
            takenKeys={ctx.takenKeys}
            fieldChoices={ctx.fieldChoices.filter((c) => c.value !== key)}
            previousKey={previousKey}
          />
        </div>
      ) : null}
      {spec?.hasFields ? (
        <div className="border-t px-3 pb-3 pt-2 sm:pl-12">
          <p className="mb-2 text-sm font-medium text-muted-foreground">{type === 'repeatable_group' ? 'Asked for each item' : 'In this group'}</p>
          <FieldList arrayPath={[...path, 'fields']} doc={doc} update={update} selected={selected} onSelect={onSelect} ctx={ctx} addLabel="Add to this group" />
        </div>
      ) : null}
    </li>
  );
}

export function FieldList({
  arrayPath,
  doc,
  update,
  selected,
  onSelect,
  ctx,
  addLabel,
}: {
  arrayPath: Path;
  doc: Obj;
  update: Update;
  selected: string | null;
  onSelect: (p: string | null) => void;
  ctx: ListCtx;
  addLabel: string;
}) {
  const { readOnly, refs, fresh } = useStudio();
  const [picker, setPicker] = useState(false);
  const fields = asArr(getIn(doc, arrayPath)).map(asObj);
  const drag = useDragReorder(pathKey(arrayPath), (from, to) => {
    update((d) => moveItem(d, arrayPath, from, to) as Obj);
    onSelect(remapSelection(selected, arrayPath, from, to));
  });
  return (
    <div className="grid gap-2">
      {fields.length === 0 ? (
        <Hint className="rounded-md border border-dashed p-3 text-center">
          {readOnly ? 'Nothing here yet.' : ctx.mode === 'job_schema' ? 'No details yet. Add the first one.' : 'No questions here yet. Add the first one.'}
        </Hint>
      ) : null}
      <ul className="grid gap-2">
        {fields.map((f, i) => (
          <FieldRowCard key={i} arrayPath={arrayPath} index={i} count={fields.length} field={f} doc={doc} update={update} selected={selected} onSelect={onSelect} ctx={ctx} drag={drag} />
        ))}
      </ul>
      {!readOnly ? (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => setPicker(true)}>
            <Plus /> {addLabel}
          </Button>
        </div>
      ) : null}
      <ComponentPicker
        open={picker}
        onOpenChange={setPicker}
        allow={ctx.allow}
        takenKeys={ctx.takenKeys}
        refs={refs}
        title={ctx.mode === 'job_schema' ? 'Add a detail' : 'Add a question'}
        onPick={(field, key) => {
          const idx = fields.length;
          fresh.add(key);
          update((d) => insertAt(d, arrayPath, asArr(getIn(d, arrayPath)).length, field) as Obj);
          onSelect(pathKey([...arrayPath, idx]));
        }}
      />
    </div>
  );
}

/** Shared list context (labels, keys, choices) for a form or job schema document. */
export function useListCtx(doc: Obj, mode: Mode, allow?: (spec: ComponentSpec) => boolean): ListCtx {
  const { refs } = useStudio();
  return useMemo(() => {
    const root = mode === 'job_schema' ? 'attributes' : 'sections';
    const choices: { value: string; label: string }[] = [];
    const walk = (fields: unknown) => {
      for (const raw of asArr(fields)) {
        const f = asObj(raw);
        if (typeof f.key === 'string' && COMPONENTS[asStr(f.type)]?.valueType !== 'none') choices.push({ value: f.key, label: fieldLabelOf(f) || f.key });
        if (Array.isArray(f.fields)) walk(f.fields);
      }
    };
    if (mode === 'job_schema') walk(doc.attributes);
    else for (const s of asArr(doc.sections)) walk(asObj(s).fields);
    const keys = allFieldKeys(doc, root);
    return {
      mode,
      vocab: buildVocab(doc, refs.bundle.jobSchema),
      takenKeys: keys,
      orderedKeys: keys,
      fieldChoices: choices,
      sections: asArr(doc.sections).map((s, i) => ({ index: i, title: asStr(asObj(s).title) || asStr(asObj(s).key) || `Section ${i + 1}` })),
      allow,
    };
  }, [doc, mode, allow, refs.bundle.jobSchema]);
}

function SectionSettings({ index, section, update, vocab }: { index: number; section: Obj; update: Update; vocab: RuleVocabulary }) {
  const advanced = useIsAdvanced();
  const { readOnly, fresh } = useStudio();
  const [writing, setWriting] = useState(false);
  const path = ['sections', index];
  const set = (k: string, v: unknown) => update((d) => setProp(d, path, k, v) as Obj);
  const key = asStr(section.key);
  return (
    <div className="grid gap-4 border-t p-4">
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="Section title"
          value={asStr(section.title)}
          onChange={(v) =>
            update((d) => {
              let next = setProp(d, path, 'title', v);
              if (fresh.has(`section:${key}`)) {
                const taken = asArr(asObj(d).sections).map((s, i) => (i === index ? '' : asStr(asObj(s).key)));
                const nk = uniqueKey(toKey(v || 'section', 'section'), taken);
                fresh.delete(`section:${key}`);
                fresh.add(`section:${nk}`);
                next = setProp(next, path, 'key', nk);
              }
              return next as Obj;
            })
          }
        />
        <TextField label="Description" value={asStr(section.description)} onChange={(v) => set('description', v)} placeholder="Optional" />
      </div>
      {advanced ? (
        <TextField label="Technical name" value={key} onChange={(v) => set('key', v)} mono hint="Visit steps refer to the section by this name." />
      ) : (
        <Details summary="Technical name">
          <p className="text-sm text-muted-foreground">
            Saved as <code className="rounded border px-1 py-0.5">{key}</code>
          </p>
        </Details>
      )}
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">When it shows</span>
        {isRule(section.visible) ? (
          <RuleLine sentence={slotSentence('visible', section.visible, vocab)} rule={section.visible} onChange={(v) => set('visible', v)} onRemove={() => set('visible', undefined)} removeLabel="Always show" />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{section.visible === false ? 'Never shown' : 'Always'}</span>
            {advanced && !readOnly && !writing ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setWriting(true)}>
                <Plus /> Show only when…
              </Button>
            ) : null}
          </div>
        )}
        {writing ? (
          <JsonPartEditor
            value={{ '==': [{ var: 'job.attributes.risk_tier' }, 'high'] }}
            label="Show this section when (JSON logic)"
            rows={5}
            onCancel={() => setWriting(false)}
            onApply={(v) => {
              set('visible', v);
              setWriting(false);
            }}
          />
        ) : null}
      </div>
      <SwitchField label="Start this section on a new page (PDF report)" checked={section.page_break === true} onChange={(v) => set('page_break', v ? true : undefined)} />
      <AdvancedJsonButton
        value={Object.fromEntries(Object.entries(section).filter(([k]) => k !== 'fields'))}
        onApply={(v) => update((d) => updateIn(d, path, (cur) => ({ ...asObj(v), fields: asObj(cur).fields ?? [] })) as Obj)}
        label="Edit section settings as JSON"
      />
    </div>
  );
}

function SectionCard({
  index,
  count,
  section,
  props,
  ctx,
  collapsed,
  onToggle,
  drag,
}: {
  index: number;
  count: number;
  section: Obj;
  props: EditorProps;
  ctx: ListCtx;
  collapsed: boolean;
  onToggle: () => void;
  drag: ReturnType<typeof useDragReorder>;
}) {
  const { doc, update, selected, onSelect } = props;
  const { readOnly } = useStudio();
  const [confirm, setConfirm] = useState(false);
  const pk = `sections/${index}`;
  const isSelected = selected === pk;
  const fields = asArr(section.fields);
  const title = asStr(section.title) || asStr(section.key) || `Section ${index + 1}`;

  function remove() {
    const removed = section;
    update((d) => removeAt(d, ['sections'], index) as Obj);
    if (selected?.startsWith('sections/')) onSelect(null);
    toast(`Removed section “${title}”`, { action: { label: 'Undo', onClick: () => update((d) => insertAt(d, ['sections'], index, removed) as Obj) } });
  }

  return (
    <Card {...drag.target(index)} className={cn('overflow-hidden', isSelected && 'border-primary ring-2 ring-primary/25', drag.over === index && 'border-primary ring-2 ring-primary/30')}>
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        {drag.handle(index)}
        <IconAction label={collapsed ? 'Expand section' : 'Collapse section'} onClick={onToggle}>
          {collapsed ? <ChevronRight /> : <ChevronDown />}
        </IconAction>
        <button type="button" onClick={() => onSelect(isSelected ? null : pk)} className="min-w-0 flex-1 text-left" aria-expanded={isSelected}>
          <span className="block text-xs font-medium text-muted-foreground">Section {index + 1}</span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{title}</span>
            <Badge tone="muted">{fields.length === 1 ? '1 question' : `${fields.length} questions`}</Badge>
            {isRule(section.visible) ? <Badge tone="progress">Shown sometimes</Badge> : null}
            {section.page_break === true ? <Badge tone="muted">New page</Badge> : null}
          </span>
          {isRule(section.visible) ? <span className="block text-sm text-violet-800">{slotSentence('visible', section.visible, ctx.vocab)}</span> : null}
        </button>
        <IconAction label="Section settings" onClick={() => onSelect(isSelected ? null : pk)}>
          <Settings2 />
        </IconAction>
        {!readOnly ? (
          <>
            <ReorderButtons
              index={index}
              count={count}
              noun="section"
              onMove={(from, to) => {
                update((d) => moveItem(d, ['sections'], from, to) as Obj);
                onSelect(remapSelection(selected, ['sections'], from, to));
              }}
            />
            <IconAction label="Remove section" destructive onClick={() => (fields.length ? setConfirm(true) : remove())}>
              <Trash2 />
            </IconAction>
          </>
        ) : null}
      </div>
      {isSelected ? <SectionSettings index={index} section={section} update={update} vocab={ctx.vocab} /> : null}
      {!collapsed ? (
        <div className="p-3">
          <FieldList arrayPath={['sections', index, 'fields']} doc={doc} update={update} selected={selected} onSelect={onSelect} ctx={ctx} addLabel="Add a question" />
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Remove section “${title}”?`}
        description={`It has ${fields.length} question${fields.length === 1 ? '' : 's'}. You can undo straight after, or start again from the published version.`}
        confirmLabel="Remove section"
        destructive
        onConfirm={remove}
      />
    </Card>
  );
}

export function FormEditor(props: EditorProps) {
  const { doc, update, selected, onSelect } = props;
  const { readOnly, refs, fresh } = useStudio();
  const ctx = useListCtx(doc, 'form');
  const sections = asArr(doc.sections).map(asObj);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const drag = useDragReorder('sections', (from, to) => {
    update((d) => moveItem(d, ['sections'], from, to) as Obj);
    onSelect(remapSelection(selected, ['sections'], from, to));
  });
  const selectedSection = selected?.startsWith('sections/') ? Number(selected.split('/')[1]) : -1;
  const questionCount = ctx.takenKeys.length;

  function addSection() {
    const taken = sections.map((s) => asStr(s.key));
    const key = uniqueKey('new_section', taken);
    fresh.add(`section:${key}`);
    update((d) => insertAt(d, ['sections'], asArr(d.sections).length, { key, title: 'New section', fields: [] }) as Obj);
    onSelect(`sections/${sections.length}`);
  }

  return (
    <div className="grid gap-4">
      <DocumentHeader doc={doc} update={update} showLocale titleLabel="Title">
        <SelectField
          label="Declaration the agent agrees to"
          hint="The statement the agent agrees to before sending the visit in. Set up on the Declarations page."
          value={asStr(doc.declaration_key) || undefined}
          onChange={(v) => update((d) => setProp(d, [], 'declaration_key', v) as Obj)}
          unsetLabel="None"
          options={refs.declarations.map((d) => ({ value: d.key, label: d.title }))}
          className="md:max-w-md"
        />
      </DocumentHeader>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {sections.length} section{sections.length === 1 ? '' : 's'} · {questionCount} question{questionCount === 1 ? '' : 's'}. Click a question to change it.
        </p>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>
            Expand all
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setCollapsed(new Set(sections.map((_, i) => i)))}>
            Collapse all
          </Button>
        </div>
      </div>
      <div className="grid gap-4">
        {sections.map((s, i) => (
          <SectionCard
            key={i}
            index={i}
            count={sections.length}
            section={s}
            props={props}
            ctx={ctx}
            collapsed={collapsed.has(i) && selectedSection !== i}
            onToggle={() =>
              setCollapsed((c) => {
                const n = new Set(c);
                if (n.has(i)) n.delete(i);
                else n.add(i);
                return n;
              })
            }
            drag={drag}
          />
        ))}
      </div>
      {!readOnly ? (
        <div>
          <Button type="button" variant="outline" onClick={addSection}>
            <Plus /> Add a section
          </Button>
        </div>
      ) : null}
    </div>
  );
}
