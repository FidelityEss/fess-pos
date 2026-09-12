'use client';

// View editor: a screen as an outline of components (docs/04 §3.4, docs/11 §7.2) — title, label/value rows, the
// job list, total tiles… Simple props are editable inline; nested tiles of a "row of totals" are their own list.
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { StructuredView } from '@/components/structured-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { type PropSpec, templatePaths, VIEW_COMPONENTS } from '@/lib/engine';
import { useIsAdvanced } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { enumLabel, propLabel, VIEW_GROUP_LABEL, viewWording } from './catalogue-ui';
import { DocumentHeader } from './document-header';
import { asArr, asObj, asStr, clone, getIn, insertAt, isRule, moveItem, type Obj, type Path, pathKey, remapSelection, removeAt, setProp, updateIn } from './doc';
import { ChoiceDialog, TargetField, targetText } from './pickers';
import { slotSentence, valueText } from './rule-english';
import {
  AdvancedJsonButton,
  CheckList,
  type EditorProps,
  Highlighted,
  Hint,
  IconAction,
  NumberField,
  ReorderButtons,
  Row,
  RuleLine,
  SelectField,
  SwitchField,
  TextField,
  type Update,
  useDragReorder,
  useStudio,
} from './shared';

const VIEW_PATHS = [
  'job.merchant_name',
  'job.reference',
  'job.status',
  'job.address',
  'job.location',
  'job.scheduled',
  'job.scheduled_start',
  'job.onsite_contact',
  'job.mcc.description',
  'job.bank.name',
  'job.notes',
  'agent.first_name',
  'agent.last_name',
  'stats.active',
  'stats.due_today',
  'stats.awaiting_review',
  'stats.completed_this_month',
  'inspection.receipt',
];

const ZERO_HASH = '0'.repeat(64);

export function newViewItem(type: string): Obj {
  const defaults: Record<string, Obj> = {
    title: { text: 'Title' },
    field_value: { label: 'Label', bind: 'job.reference' },
    address_block: { bind: 'job.address' },
    map_preview: { bind: 'job.location', height: 180 },
    contact: { bind: 'job.onsite_contact', actions: ['call'] },
    schedule_window: { bind: 'job.scheduled' },
    status_chip: { bind: 'job.status' },
    badge: { text: 'Badge', tone: 'info' },
    markdown: { text: 'Text' },
    image: { asset: { sha256: ZERO_HASH } },
    evidence_status: { bind: 'inspection.receipt' },
    greeting: { text: 'Hi {{agent.first_name}}' },
    section_title: { text: 'Heading' },
    stat_row: { tiles: [{ type: 'stat_tile', label: 'Active', source: 'server', stat: 'stats.active' }] },
    stat_tile: { label: 'Total', source: 'server', stat: 'stats.active' },
    job_list: { item_view: 'job_card', limit: 20, sort: 'job.scheduled_start', sort_direction: 'asc' },
    agent_card_summary: { on_tap: { page: 'agent_card' } },
    action_button: { label: 'Open', target: { page: 'home' } },
    announcement: { text: 'Announcement', tone: 'info' },
    agent_card: { show_photo: true, show_qr: true, show_status: true },
    job_card: { show_photo: true, show_qr: true, show_status: true },
  };
  return { type, ...(defaults[type] ?? {}) };
}

function itemSummary(it: Obj, strings: Record<string, string> | undefined, pageTitle: (k: string) => string, viewTitle: (k: string) => string): string {
  const parts: string[] = [];
  if (typeof it.label === 'string') parts.push(it.label);
  if (typeof it.text === 'string') parts.push(it.text);
  if (typeof it.bind === 'string') parts.push(`shows ${valueText({ var: it.bind })}`);
  if (typeof it.stat === 'string') parts.push(`counts ${valueText({ var: it.stat })}`);
  else if (typeof it.collection === 'string') parts.push(`counts ${asStr(it.collection).replace(/_/g, ' ')} on the phone`);
  if (it.type === 'job_list') parts.push(`up to ${typeof it.limit === 'number' ? it.limit : 'all'} jobs, each shown as “${viewTitle(asStr(it.item_view))}”`);
  if (typeof it.empty_content === 'string') parts.push(`when empty: “${strings?.[it.empty_content] ?? it.empty_content}”`);
  const tap = targetText(it.on_tap ?? it.target, pageTitle);
  if (tap) parts.push(tap);
  if (Array.isArray(it.tiles)) parts.push(`${it.tiles.length} tile${it.tiles.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function ItemProps({ path, item, update }: { path: Path; item: Obj; update: Update }) {
  const advanced = useIsAdvanced();
  const { refs } = useStudio();
  const type = asStr(item.type);
  const spec = VIEW_COMPONENTS[type];
  const set = (k: string, v: unknown) => update((d) => setProp(d, path, k, v) as Obj);
  const flows = refs.families.flow.map((f) => ({ key: f.key, title: f.title }));
  if (!spec) return <Hint>This component isn&apos;t in the catalogue; it is kept as it is.</Hint>;
  const entries = Object.entries(spec.props).filter(([n]) => n !== 'tiles');
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {entries.map(([name, ps]) => (
        <div key={name} className={cn(['text', 'filter'].includes(name) && 'sm:col-span-2')}>
          <ViewProp name={name} spec={ps} value={item[name]} onChange={(v) => set(name, v)} flows={flows} advanced={advanced} />
        </div>
      ))}
    </div>
  );
}

function ViewProp({ name, spec, value, onChange, flows, advanced }: { name: string; spec: PropSpec; value: unknown; onChange: (v: unknown) => void; flows: { key: string; title: string }[]; advanced: boolean }) {
  const { refs } = useStudio();
  const { label, hint } = propLabel(name);
  const niceLabel = VIEW_PROP_LABEL[name] ?? label;
  if (spec.ruleable && (isRule(value) || name === 'filter')) {
    return (
      <Row label={name === 'filter' ? 'Which records' : niceLabel}>
        {isRule(value) ? (
          <RuleLine sentence={slotSentence('filter', value)} rule={value} onChange={onChange} onRemove={() => onChange(undefined)} removeLabel="Show everything" />
        ) : (
          <span className="text-sm">Everything</span>
        )}
      </Row>
    );
  }
  const k = spec.kind;
  switch (k.t) {
    case 'template':
      return (
        <TextField
          label={niceLabel}
          value={asStr(value)}
          onChange={(v) => onChange(v || undefined)}
          multiline={name === 'text'}
          rows={name === 'text' ? 3 : 2}
          hint={templatePaths(asStr(value)).length ? <>Filled in by the app: {templatePaths(asStr(value)).map((p) => `{{${p}}}`).join(', ')}</> : hint}
        />
      );
    case 'string':
      if (name === 'empty_content')
        return (
          <SelectField
            label="Text when the list is empty"
            value={asStr(value) || undefined}
            onChange={onChange}
            unsetLabel="None"
            options={Object.entries(refs.bundle.strings ?? {}).map(([key, text]) => ({ value: key, label: `${text.slice(0, 60)}${text.length > 60 ? '…' : ''}` }))}
          />
        );
      return <TextField label={niceLabel} value={asStr(value)} onChange={(v) => onChange(v || undefined)} />;
    case 'path':
      return (
        <Row label={niceLabel} hint={value ? <>Shows {valueText({ var: asStr(value) })}.</> : hint}>
          <input
            list="studio-view-paths"
            value={asStr(value)}
            onChange={(e) => onChange(e.target.value || undefined)}
            className="flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 font-mono text-sm shadow-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            aria-label={niceLabel}
          />
        </Row>
      );
    case 'enum':
      return <SelectField label={niceLabel} value={asStr(value) || undefined} onChange={onChange} unsetLabel="Default" options={k.values.map((v) => ({ value: v, label: enumLabel(v) }))} />;
    case 'enum_list':
      return <CheckList label={niceLabel} values={asArr(value).map(String)} onChange={(v) => onChange(v.length ? v : undefined)} options={k.values.map((v) => ({ value: v, label: enumLabel(v) }))} />;
    case 'bool':
      return <SwitchField label={niceLabel} checked={value === true} onChange={onChange} />;
    case 'int':
    case 'number':
      return <NumberField label={niceLabel} value={typeof value === 'number' ? value : undefined} onChange={onChange} min={k.min} max={k.max} step={1} />;
    case 'key':
      return <SelectField label={niceLabel} value={asStr(value) || undefined} onChange={onChange} options={refs.families.view.map((v) => ({ value: v.key, label: v.title }))} />;
    case 'target':
      return <TargetField label={niceLabel} value={value} onChange={onChange} pages={refs.appPages} flows={flows} />;
    default:
      return (
        <Row label={niceLabel}>
          {value === undefined ? <Hint>Not set</Hint> : <StructuredView value={value} className="rounded-md border bg-card p-2" />}
          {advanced ? <AdvancedJsonButton value={value} onApply={onChange} label={`Edit ${niceLabel.toLowerCase()} as JSON`} /> : null}
        </Row>
      );
  }
}

const VIEW_PROP_LABEL: Record<string, string> = {
  bind: 'Shows',
  text: 'Text',
  label: 'Label',
  format: 'Show as',
  height: 'Height (pixels)',
  actions: 'Buttons',
  tone: 'Colour',
  caption: 'Caption',
  source: 'Counts',
  collection: 'Which records',
  stat: 'Server total',
  on_tap: 'When tapped',
  title: 'Heading',
  sort: 'Sort by',
  sort_direction: 'Order',
  item_view: 'Each item looks like',
  limit: 'Show at most',
  target: 'Opens',
  style: 'Style',
  show_photo: 'Show the photo',
  show_qr: 'Show the QR code',
  show_status: 'Show the status',
};

function ItemList({ arrayPath, props, allowed, addLabel }: { arrayPath: Path; props: EditorProps; allowed?: string[]; addLabel: string }) {
  const { doc, update, selected, onSelect } = props;
  const advanced = useIsAdvanced();
  const { readOnly, refs } = useStudio();
  const [adding, setAdding] = useState(false);
  const items = asArr(getIn(doc, arrayPath)).map(asObj);
  const drag = useDragReorder(pathKey(arrayPath), move);

  function move(from: number, to: number) {
    update((d) => moveItem(d, arrayPath, from, to) as Obj);
    onSelect(remapSelection(selected, arrayPath, from, to));
  }
  function remove(i: number) {
    const removed = items[i];
    update((d) => removeAt(d, arrayPath, i) as Obj);
    onSelect(null);
    toast(`Removed “${viewWording(asStr(removed?.type)).name}”`, { action: { label: 'Undo', onClick: () => update((d) => insertAt(d, arrayPath, i, removed) as Obj) } });
  }
  function duplicate(i: number) {
    const copy = clone(items[i] ?? {});
    delete copy.id;
    update((d) => insertAt(d, arrayPath, i + 1, copy) as Obj);
    onSelect(pathKey([...arrayPath, i + 1]));
  }
  const types = (allowed ?? Object.keys(VIEW_COMPONENTS)).filter((t) => t !== 'stat_tile' || allowed);

  return (
    <div className="grid gap-2">
      <ol className="grid gap-2">
        {items.map((it, i) => {
          const type = asStr(it.type);
          const w = viewWording(type);
          const path = [...arrayPath, i];
          const pk = pathKey(path);
          const isSel = selected === pk;
          return (
            <li key={i} {...drag.target(i)} className={cn('rounded-lg border bg-card', isSel && 'border-primary ring-2 ring-primary/25', drag.over === i && 'border-primary ring-2 ring-primary/30')}>
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
                {drag.handle(i)}
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <w.icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-medium">{w.name}</span>
                    {isRule(it.visible) ? <Badge tone="progress">Conditional</Badge> : null}
                    {advanced && typeof it.id === 'string' ? <code className="text-xs text-muted-foreground">{it.id}</code> : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <Highlighted
                      text={
                        itemSummary(
                          it,
                          refs.bundle.strings,
                          (k) => `“${refs.appPages.find((p) => p.key === k)?.title ?? k}”`,
                          (k) => refs.families.view.find((v) => v.key === k)?.title ?? k,
                        ) || w.description
                      }
                    />
                  </p>
                  {isRule(it.visible) ? <p className="text-sm text-violet-800">{slotSentence('visible', it.visible)}</p> : null}
                </div>
                {!readOnly ? (
                  <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                    <ReorderButtons index={i} count={items.length} onMove={move} />
                    <IconAction label="Duplicate" onClick={() => duplicate(i)}>
                      <Copy />
                    </IconAction>
                    <IconAction label="Remove" destructive onClick={() => remove(i)}>
                      <Trash2 />
                    </IconAction>
                  </div>
                ) : null}
              </div>
              {isSel ? (
                <div className="grid gap-4 border-t bg-slate-50/70 p-4">
                  <ItemProps path={path} item={it} update={update} />
                  {isRule(it.visible) ? (
                    <RuleLine sentence={slotSentence('visible', it.visible)} rule={it.visible} onChange={(v) => update((d) => setProp(d, path, 'visible', v) as Obj)} onRemove={() => update((d) => setProp(d, path, 'visible', undefined) as Obj)} removeLabel="Always show" />
                  ) : null}
                  <AdvancedJsonButton value={it} onApply={(v) => update((d) => updateIn(d, path, () => asObj(v)) as Obj)} label="Edit this item as JSON" />
                </div>
              ) : null}
              {type === 'stat_row' ? (
                <div className="border-t px-3 pb-3 pt-2 sm:pl-12">
                  <p className="mb-2 text-sm font-medium text-muted-foreground">Tiles</p>
                  <ItemList arrayPath={[...path, 'tiles']} props={props} allowed={['stat_tile']} addLabel="Add a tile" />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {items.length === 0 ? <Hint>Nothing on this screen yet.</Hint> : null}
      {!readOnly ? (
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              if (allowed?.length === 1) {
                const t = allowed[0] as string;
                update((d) => insertAt(d, arrayPath, asArr(getIn(d, arrayPath)).length, newViewItem(t)) as Obj);
                onSelect(pathKey([...arrayPath, items.length]));
              } else setAdding(true);
            }}
          >
            <Plus /> {addLabel}
          </Button>
        </div>
      ) : null}
      <ChoiceDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add to the screen"
        choices={types.map((t) => ({ value: t, group: VIEW_GROUP_LABEL[VIEW_COMPONENTS[t]?.group ?? ''] ?? '', ...viewWording(t) }))}
        onPick={(t) => {
          update((d) => insertAt(d, arrayPath, asArr(getIn(d, arrayPath)).length, newViewItem(t)) as Obj);
          onSelect(pathKey([...arrayPath, items.length]));
        }}
      />
    </div>
  );
}

export function ViewEditor(props: EditorProps) {
  const { doc, update } = props;
  return (
    <div className="grid gap-4">
      <DocumentHeader doc={doc} update={update} />
      <Card>
        <CardContent className="grid gap-3 p-4">
          <div>
            <h3 className="text-base font-semibold">On this screen, top to bottom</h3>
            <Hint>Click an item to change it. Values such as the merchant name come from the job the agent opens.</Hint>
          </div>
          <ItemList arrayPath={['items']} props={props} addLabel="Add to the screen" />
        </CardContent>
      </Card>
      <datalist id="studio-view-paths">
        {VIEW_PATHS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </div>
  );
}
