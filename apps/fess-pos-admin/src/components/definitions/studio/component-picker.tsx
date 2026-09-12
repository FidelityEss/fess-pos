'use client';

// "Add a question" — a component picker grouped and described in plain language (from the engine catalogue), then a
// label; the answer key is derived from the label (snake_case, unique) and keeps following it while the field is new.
import { ChevronLeft, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { COMPONENTS, type ComponentSpec } from '@/lib/engine';
import { useIsAdvanced } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import type { StudioRefs } from './bundle';
import { CATEGORY_LABEL, CATEGORY_ORDER, componentWording } from './catalogue-ui';
import { type Obj, toKey, uniqueKey } from './doc';

/** Components whose essential settings need Advanced view (a rule or an asset hash). */
const ADVANCED_ONLY = new Set(['computed', 'matrix', 'image']);

/** A new field of `type` with sensible defaults for its required props. */
export function newField(type: string, label: string, key: string, refs: StudioRefs): Obj {
  const spec = COMPONENTS[type];
  const firstDecl = refs.declarations[0]?.key ?? 'agent_declaration';
  if (spec?.shape === 'display') {
    if (type === 'callout') return { key, type, tone: 'info', text: label || 'Notice' };
    if (type === 'info') return { key, type, text: label || 'Information for the agent' };
    if (type === 'image') return { key, type, asset: { sha256: '0'.repeat(64) } };
    return { key, type };
  }
  const base: Obj = { key, type, label };
  const question = spec && spec.valueType !== 'none' && type !== 'computed' && type !== 'prefilled';
  if (question) base.required = true;
  switch (type) {
    case 'single_select':
    case 'multi_select':
      base.options = [
        { value: 'option_1', label: 'Option 1' },
        { value: 'option_2', label: 'Option 2' },
      ];
      if (type === 'single_select') base.display = 'radio';
      else base.display = 'checkboxes';
      break;
    case 'boolean':
      base.display = 'yes_no_radio';
      break;
    case 'photo':
      base.display = 'grid';
      base.props = { category: toKey(label || 'photos', 'photos').slice(0, 40), min_count: 1, max_count: 5, require_gps: true };
      break;
    case 'textarea':
      base.props = { rows: 3 };
      break;
    case 'declaration':
      base.props = { declaration_key: firstDecl };
      break;
    case 'consent':
      base.props = { declaration_key: firstDecl };
      break;
    case 'acknowledgement':
      base.props = { text: label || 'I confirm' };
      break;
    case 'prefilled':
      base.props = { source: 'job.merchant_name' };
      break;
    case 'computed':
      base.value = { today: [] };
      break;
    case 'slider':
      base.props = { min: 0, max: 10 };
      break;
    case 'id_number':
      base.props = { scheme: 'za_id' };
      break;
    case 'registration_number':
      base.props = { scheme: 'cipc' };
      break;
    case 'phone':
      base.props = { default_region: 'ZA' };
      break;
    case 'lookup':
      base.props = { list: refs.lookupLists[0]?.key ?? 'list_key' };
      break;
    case 'matrix':
      base.props = { rows: [{ key: 'row_1', label: 'Row 1' }], columns: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], cell_type: 'single' };
      break;
    case 'group':
    case 'repeatable_group':
      delete base.required;
      base.fields = [];
      break;
    default:
      break;
  }
  return base;
}

export function ComponentPicker({
  open,
  onOpenChange,
  allow,
  takenKeys,
  refs,
  onPick,
  title = 'Add a question',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which components may be added here (e.g. job schema: non-evidence inputs). */
  allow?: (spec: ComponentSpec) => boolean;
  takenKeys: readonly string[];
  refs: StudioRefs;
  onPick: (field: Obj, key: string) => void;
  title?: string;
}) {
  const advanced = useIsAdvanced();
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [label, setLabel] = useState('');

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CATEGORY_ORDER.map((cat) => ({
      cat,
      items: Object.values(COMPONENTS).filter((s) => {
        if (s.category !== cat) return false;
        if (allow && !allow(s)) return false;
        if (!advanced && ADVANCED_ONLY.has(s.type)) return false;
        if (!q) return true;
        const w = componentWording(s.type);
        return [w.name, w.description, s.type].some((t) => t.toLowerCase().includes(q));
      }),
    })).filter((g) => g.items.length > 0);
  }, [search, allow, advanced]);

  const spec = chosen ? COMPONENTS[chosen] : undefined;
  const isDisplay = spec?.shape === 'display';
  const key = uniqueKey(toKey(label || (chosen ? componentWording(chosen).name : 'field'), 'field'), takenKeys);

  function reset(o: boolean) {
    if (!o) {
      setChosen(null);
      setLabel('');
      setSearch('');
    }
    onOpenChange(o);
  }

  function add() {
    if (!chosen) return;
    onPick(newField(chosen, label.trim(), key, refs), key);
    reset(false);
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{chosen ? componentWording(chosen).name : title}</DialogTitle>
          <DialogDescription>
            {chosen ? componentWording(chosen).description : 'Choose what kind of answer the agent gives. You can change the details afterwards.'}
          </DialogDescription>
        </DialogHeader>
        {!chosen ? (
          <div className="grid gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search, e.g. photo, date, yes/no…" className="pl-8" aria-label="Search components" />
            </div>
            <div className="max-h-[58vh] space-y-4 overflow-y-auto pr-1">
              {groups.length === 0 ? <p className="text-sm text-muted-foreground">Nothing matches “{search}”.</p> : null}
              {groups.map((g) => (
                <section key={g.cat}>
                  <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{CATEGORY_LABEL[g.cat]}</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {g.items.map((s) => {
                      const w = componentWording(s.type);
                      return (
                        <button
                          key={s.type}
                          type="button"
                          onClick={() => setChosen(s.type)}
                          className="flex items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                            <w.icon className="size-5" />
                          </span>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-1.5 text-base font-medium">
                              {w.name}
                              {advanced && s.wave === 2 ? <Badge tone="muted">Wave 2</Badge> : null}
                            </span>
                            <span className="block text-sm text-muted-foreground">{w.description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">{isDisplay ? 'Text' : 'Question (label the agent sees)'}</span>
              <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? add() : undefined)} placeholder={isDisplay ? 'e.g. Take photos in daylight' : 'e.g. Is the business open?'} />
            </label>
            <p className={cn('text-sm text-muted-foreground')}>
              Saved as <code className="rounded bg-muted px-1 py-0.5 text-sm">{key}</code> — the name used in answers, rules and exports.
            </p>
          </div>
        )}
        <DialogFooter>
          {chosen ? (
            <Button type="button" variant="ghost" onClick={() => setChosen(null)} className="mr-auto">
              <ChevronLeft /> Back
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => reset(false)}>
            Cancel
          </Button>
          {chosen ? (
            <Button type="button" onClick={add}>
              Add
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
