'use client';

// Job information (docs/04 §3.3, docs/17 §4.6): the job form as the office sees it. The bank's extra details are shown
// grouped by what they're about (Merchant, Where, Who to contact, When), each drawn as it will look on the new-job
// form, beside what every job already asks for. Click a detail to change it where it sits; technical settings (the
// technical name, format patterns) sit behind "Format and technical details" or in Advanced view.
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AttributeInput } from '@/components/jobs/job-bits';
import { type AttributeDef, attributeDefs } from '@/components/jobs/job-data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ComponentSpec } from '@/lib/engine';
import { useIsAdvanced } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { AdvicePanel } from './advice-panel';
import { componentWording } from './catalogue-ui';
import { ComponentPicker } from './component-picker';
import { DocumentHeader } from './document-header';
import { asArr, asObj, asStr, insertAt, moveItem, type Obj, pathKey, remapSelection, removeAt } from './doc';
import { FieldInspector } from './field-inspector';
import { useListCtx } from './form-editor';
import { JOB_GROUPS, type JobGroupInfo, jobGroupOf } from './job-groups';
import { localAdvice } from './local-advice';
import { type EditorProps, Hint, IconAction, ReorderButtons, useDragReorder, useStudio } from './shared';

const allowJobSchema = (spec: ComponentSpec) => spec.jobSchema;
const noop = () => undefined;

interface Item {
  attr: Obj;
  /** Position in the saved list (the groups are display only). */
  index: number;
}

type ListCtx = ReturnType<typeof useListCtx>;

function AttributeRow({
  item,
  position,
  count,
  drag,
  onMove,
  props,
  ctx,
  def,
}: {
  item: Item;
  position: number;
  count: number;
  drag: ReturnType<typeof useDragReorder>;
  onMove: (from: number, to: number) => void;
  props: EditorProps;
  ctx: ListCtx;
  def: AttributeDef | undefined;
}) {
  const advanced = useIsAdvanced();
  const { readOnly } = useStudio();
  const { update, selected, onSelect } = props;
  const path = ['attributes', item.index];
  const pk = pathKey(path);
  const isSelected = selected === pk;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (isSelected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [isSelected]);
  const a = item.attr;
  const key = asStr(a.key);
  const label = asStr(a.label);
  const w = componentWording(asStr(a.type));
  const help = asStr(a.help_text);

  function remove() {
    const removed = a;
    update((d) => removeAt(d, ['attributes'], item.index) as Obj);
    if (selected?.startsWith('attributes/')) onSelect(null);
    toast(`Removed “${label || w.name}”`, { action: { label: 'Undo', onClick: () => update((d) => insertAt(d, ['attributes'], item.index, removed) as Obj) } });
  }

  return (
    <li
      ref={ref}
      {...drag.target(position)}
      className={cn('rounded-lg border bg-card', isSelected && 'border-primary ring-2 ring-primary/25', drag.over === position && 'border-primary ring-2 ring-primary/30')}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isSelected}
        onClick={() => onSelect(isSelected ? null : pk)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onSelect(isSelected ? null : pk);
          }
        }}
        className="flex cursor-pointer items-start gap-2 rounded-lg p-3 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {drag.handle(position)}
        <div className="grid min-w-0 flex-1 gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('text-sm font-medium', !label && 'italic text-muted-foreground')}>
              {label || 'No label yet'}
              {a.required === true ? (
                <span className="text-destructive" aria-hidden>
                  {' '}
                  *
                </span>
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground">{w.name}</span>
            <Badge tone={a.required === true ? 'neutral' : 'muted'}>{a.required === true ? 'Must be filled in' : 'Optional'}</Badge>
            {advanced ? <code className="text-xs text-muted-foreground">{key}</code> : null}
          </div>
          {/* The field as the office will see it on the new-job form (not usable here). */}
          <div inert className="max-w-md">
            {def ? <AttributeInput def={def} value={undefined} onChange={noop} id={`job-preview-${key}`} /> : null}
          </div>
          {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
        </div>
        {!readOnly ? (
          <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
            <ReorderButtons index={position} count={count} onMove={onMove} noun="detail" />
            <IconAction label="Remove" destructive onClick={remove}>
              <Trash2 />
            </IconAction>
          </div>
        ) : null}
      </div>
      {isSelected ? (
        <div className="border-t p-4">
          <FieldInspector path={path} field={a} update={update} vocab={ctx.vocab} mode="job_schema" takenKeys={ctx.takenKeys} fieldChoices={ctx.fieldChoices.filter((c) => c.value !== key)} />
        </div>
      ) : null}
    </li>
  );
}

function GroupCard({ group, items, props, ctx, defs }: { group: JobGroupInfo; items: Item[]; props: EditorProps; ctx: ListCtx; defs: Map<string, AttributeDef> }) {
  const { update, selected, onSelect } = props;
  // Moving within a group swaps places with the neighbouring detail of the same group in the saved list.
  const move = (from: number, to: number) => {
    const a = items[from];
    const b = items[to];
    if (!a || !b) return;
    update((d) => moveItem(d, ['attributes'], a.index, b.index) as Obj);
    onSelect(remapSelection(selected, ['attributes'], a.index, b.index));
  };
  const drag = useDragReorder(`attributes:${group.key}`, move);
  return (
    <Card>
      <CardContent className="grid gap-3 p-4">
        <div>
          <h3 className="text-base font-semibold">{group.title}</h3>
          <Hint>{group.description}</Hint>
        </div>
        {group.builtIn.length ? <p className="text-sm text-muted-foreground">Every job already asks for: {group.builtIn.join(', ')}.</p> : null}
        {group.note ? <p className="text-sm text-muted-foreground">{group.note}</p> : null}
        {items.length ? (
          <ul className="grid gap-2">
            {items.map((it, i) => (
              <AttributeRow key={it.index} item={it} position={i} count={items.length} drag={drag} onMove={move} props={props} ctx={ctx} def={defs.get(asStr(it.attr.key))} />
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">Nothing extra for this bank here.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function JobSchemaEditor(props: EditorProps) {
  const { doc, update, onSelect } = props;
  const { readOnly, refs, fresh } = useStudio();
  const ctx = useListCtx(doc, 'job_schema', allowJobSchema);
  const [picker, setPicker] = useState(false);
  const attrs = asArr(doc.attributes).map(asObj);
  const defs = useMemo(() => new Map(attributeDefs(doc).map((d) => [d.key, d])), [doc]);
  const advice = useMemo(() => localAdvice(doc, { mode: 'job_schema' }), [doc]);
  const grouped = JOB_GROUPS.map((g) => ({ group: g, items: attrs.map((attr, index) => ({ attr, index })).filter((it) => jobGroupOf(it.attr) === g.key) })).filter(
    (g) => g.group.key !== 'other' || g.items.length > 0,
  );

  return (
    <div className="grid gap-4">
      <DocumentHeader doc={doc} update={update} />
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-base font-semibold">The job form, as the office sees it</h3>
        <Hint>
          When someone in the office creates a job, they fill in what every job has, then the details below. Each detail is shown as it will look on the
          form, grouped by what it’s about (worked out from its name). Click one to change it.
        </Hint>
      </div>
      <AdvicePanel items={advice} onLocate={onSelect} readOnly={readOnly} />
      {grouped.map(({ group, items }) => (
        <GroupCard key={group.key} group={group} items={items} props={props} ctx={ctx} defs={defs} />
      ))}
      {!readOnly ? (
        <div>
          <Button type="button" variant="outline" onClick={() => setPicker(true)}>
            <Plus /> Add a detail
          </Button>
        </div>
      ) : null}
      <ComponentPicker
        open={picker}
        onOpenChange={setPicker}
        allow={allowJobSchema}
        takenKeys={ctx.takenKeys}
        refs={refs}
        title="Add a detail to the job form"
        onPick={(field, key) => {
          const idx = attrs.length;
          fresh.add(key);
          update((d) => insertAt(d, ['attributes'], asArr(d.attributes).length, field) as Obj);
          onSelect(pathKey(['attributes', idx]));
        }}
      />
    </div>
  );
}
