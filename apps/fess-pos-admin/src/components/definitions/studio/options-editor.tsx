'use client';

// Where a choice question's answers come from — a list typed here (value / label rows), reason codes by category, or a
// managed lookup list — and the editor for the typed list. Option values created in this session follow their label;
// existing values never change silently (answers and rules depend on them).
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useReasonCodes } from '@/lib/hooks';
import { labelFrom, REASON_CATEGORY_LABEL } from '@/lib/labels';
import { useIsAdvanced } from '@/lib/preferences';
import { REASON_CATEGORIES, type ReasonCategory } from '@/lib/types';
import { cn } from '@/lib/utils';
import { asArr, asObj, asStr, type Obj, type Path, toKey, uniqueKey, updateIn } from './doc';
import { Hint, IconAction, ReorderButtons, Row, SelectField, SubHeading, type Update, useDragReorder, useStudio } from './shared';

type Source = 'static' | 'reason_codes' | 'lookup_list';

function ReasonCodePreview({ category }: { category: string }) {
  const { bankId } = useStudio();
  const codes = useReasonCodes(category as ReasonCategory, bankId);
  if (codes.isPending) return <Hint>Loading the reasons…</Hint>;
  if (!codes.data?.length) return <Hint>No reasons in this group yet. Add them on the Reasons page.</Hint>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {codes.data.map((c) => (
        <Badge key={c.id} tone="neutral" className="text-sm">
          {c.label}
        </Badge>
      ))}
    </div>
  );
}

export function OptionsEditor({ path, field, update }: { path: Path; field: Obj; update: Update }) {
  const advanced = useIsAdvanced();
  const { readOnly, refs, fresh } = useStudio();
  const [stash, setStash] = useState<{ options?: unknown; options_source?: unknown }>({});
  const src = asObj(field.options_source);
  const source: Source = src.type === 'reason_codes' ? 'reason_codes' : src.type === 'lookup_list' ? 'lookup_list' : 'static';
  const options = asArr(field.options).map(asObj);
  const optsPath = [...path, 'options'];
  const drag = useDragReorder(`opts:${path.join('/')}`, (from, to) => move(from, to));

  const edit = (fn: (f: Obj) => Obj) => update((d) => updateIn(d, path, (cur) => fn({ ...asObj(cur) })) as Obj);

  function switchSource(next: Source) {
    if (next === source) return;
    edit((f) => {
      const out = { ...f };
      setStash((s) => ({ ...s, ...(f.options !== undefined ? { options: f.options } : {}), ...(f.options_source !== undefined ? { options_source: f.options_source } : {}) }));
      delete out.options;
      delete out.options_source;
      if (next === 'static') {
        out.options = stash.options ?? [
          { value: 'option_1', label: 'Option 1' },
          { value: 'option_2', label: 'Option 2' },
        ];
      } else if (next === 'reason_codes') {
        const prev = asObj(stash.options_source);
        out.options_source = prev.type === 'reason_codes' ? prev : { type: 'reason_codes', category: REASON_CATEGORIES[0] };
      } else {
        const prev = asObj(stash.options_source);
        out.options_source = prev.type === 'lookup_list' ? prev : { type: 'lookup_list', key: refs.lookupLists[0]?.key ?? 'list_key' };
      }
      return out;
    });
  }

  function setOption(i: number, patch: Obj) {
    update((d) =>
      updateIn(d, [...optsPath, i], (cur) => {
        const o = { ...asObj(cur), ...patch };
        return o;
      }) as Obj,
    );
  }

  function setLabel(i: number, label: string) {
    const current = options[i];
    const value = asStr(current?.value);
    if (fresh.has(`opt:${path.join('/')}:${value}`)) {
      const taken = options.filter((_, j) => j !== i).map((o) => asStr(o.value));
      const nv = uniqueKey(toKey(label || 'option', 'option'), taken);
      fresh.delete(`opt:${path.join('/')}:${value}`);
      fresh.add(`opt:${path.join('/')}:${nv}`);
      setOption(i, { label, value: nv });
    } else setOption(i, { label });
  }

  function add() {
    const taken = options.map((o) => asStr(o.value));
    const value = uniqueKey(`option_${options.length + 1}`, taken);
    fresh.add(`opt:${path.join('/')}:${value}`);
    update((d) => updateIn(d, optsPath, (cur) => [...asArr(cur), { value, label: `Option ${options.length + 1}` }]) as Obj);
  }

  function remove(i: number) {
    update((d) => updateIn(d, optsPath, (cur) => asArr(cur).filter((_, j) => j !== i)) as Obj);
  }

  function move(from: number, to: number) {
    update((d) =>
      updateIn(d, optsPath, (cur) => {
        const arr = [...asArr(cur)];
        if (to < 0 || to >= arr.length) return arr;
        const [it] = arr.splice(from, 1);
        arr.splice(to, 0, it);
        return arr;
      }) as Obj,
    );
  }

  const sourceButtons: { value: Source; label: string }[] = [
    { value: 'static', label: 'A list typed here' },
    { value: 'reason_codes', label: 'Reasons' },
    { value: 'lookup_list', label: 'A drop-down list' },
  ];

  return (
    <div className="grid gap-3">
      <SubHeading>Answers to choose from</SubHeading>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Where the answers come from">
        {sourceButtons.map((b) => (
          <button
            key={b.value}
            type="button"
            role="radio"
            aria-checked={source === b.value}
            disabled={readOnly}
            onClick={() => switchSource(b.value)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-60',
              source === b.value ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent',
            )}
          >
            {b.label}
          </button>
        ))}
      </div>

      {source === 'reason_codes' ? (
        <div className="grid gap-2">
          <SelectField
            label="Group of reasons"
            value={asStr(src.category)}
            onChange={(v) => edit((f) => ({ ...f, options_source: { ...src, type: 'reason_codes', category: v ?? REASON_CATEGORIES[0] } }))}
            options={REASON_CATEGORIES.map((c) => ({ value: c, label: labelFrom(REASON_CATEGORY_LABEL, c) }))}
          />
          <Row label="The agent sees">
            <ReasonCodePreview category={asStr(src.category)} />
          </Row>
        </div>
      ) : source === 'lookup_list' ? (
        <SelectField
          label="Drop-down list"
          value={asStr(src.key)}
          onChange={(v) => edit((f) => ({ ...f, options_source: { ...src, type: 'lookup_list', key: v ?? '' } }))}
          options={refs.lookupLists.map((l) => ({ value: l.key, label: advanced ? `${l.title} (${l.key})` : l.title }))}
          hint="Set up on the Drop-down lists page. The phone keeps a copy, so it works without signal."
        />
      ) : (
        <div className="grid gap-2">
          {options.length === 0 ? <Hint>No answers yet.</Hint> : null}
          <ol className="grid gap-1.5">
            {options.map((o, i) => {
              const meta = asObj(o.meta);
              return (
                <li
                  key={i}
                  {...drag.target(i)}
                  className={cn('flex items-center gap-2 rounded-md border bg-card p-1.5', drag.over === i && 'border-primary ring-2 ring-primary/30')}
                >
                  {drag.handle(i)}
                  <span className="w-6 shrink-0 text-center text-sm tabular-nums text-muted-foreground">{i + 1}</span>
                  <Input value={asStr(o.label)} onChange={(e) => setLabel(i, e.target.value)} readOnly={readOnly} aria-label={`Answer ${i + 1} label`} className="min-w-0 flex-1" />
                  {advanced ? (
                    <Input
                      value={asStr(o.value)}
                      onChange={(e) => setOption(i, { value: e.target.value })}
                      readOnly={readOnly}
                      aria-label={`Answer ${i + 1} stored value`}
                      className="w-40 font-mono"
                      title="Stored value"
                    />
                  ) : null}
                  {Object.keys(meta).length ? (
                    <Badge tone={meta.risk ? 'warning' : 'neutral'} title={JSON.stringify(meta)}>
                      {meta.risk ? `Risk: ${String(meta.risk)}` : 'Has extra data'}
                    </Badge>
                  ) : null}
                  <ReorderButtons index={i} count={options.length} onMove={move} noun="answer" />
                  {!readOnly ? (
                    <IconAction label={`Remove answer ${i + 1}`} onClick={() => remove(i)} destructive disabled={options.length <= 1}>
                      <Trash2 />
                    </IconAction>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {!readOnly ? (
            <div>
              <Button type="button" size="sm" variant="outline" onClick={add}>
                <Plus /> Add an answer
              </Button>
            </div>
          ) : null}
        </div>
      )}
      {stash.options !== undefined && source !== 'static' ? <p className="text-xs text-muted-foreground">Your typed list is kept until you leave this page. Switch back to get it back.</p> : null}
    </div>
  );
}

