'use client';

// Content editor: the wording the app and notifications use, as a searchable table of texts grouped by area
// ("sync", "notify"…). {{placeholders}} are highlighted and filled in by the app at run time.
import { Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { humanLabel } from '@/components/structured-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { isValidTemplate, templatePaths } from '@/lib/engine';
import { useIsAdvanced } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { DocumentHeader } from './document-header';
import { asObj, type Obj, renameKey, updateIn } from './doc';
import { type EditorProps, Highlighted, Hint, IconAction, useStudio } from './shared';

const CONTENT_KEY = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

function AddString({ taken, onAdd }: { taken: Set<string>; onAdd: (key: string, text: string) => void }) {
  const [key, setKey] = useState('');
  const [text, setText] = useState('');
  const problem = !key ? null : !CONTENT_KEY.test(key) ? 'Use lower-case words joined by dots, such as sync.pending' : taken.has(key) ? 'That name is already used' : null;
  return (
    <div className="grid gap-2 rounded-lg border border-dashed p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] md:items-start">
      <label className="grid gap-1">
        <span className="text-sm font-medium">Where it’s used (name)</span>
        <Input value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="area.name" className="font-mono" aria-invalid={!!problem} />
        {problem ? <span className="text-xs text-destructive">{problem}</span> : null}
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-medium">Text</span>
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="What the agent sees. Use {{name}} for values the app fills in." />
      </label>
      <Button
        type="button"
        className="md:mt-6"
        disabled={!key || !!problem}
        onClick={() => {
          onAdd(key, text);
          setKey('');
          setText('');
        }}
      >
        <Plus /> Add text
      </Button>
    </div>
  );
}

function KeyEditor({ value, taken, onRename }: { value: string; taken: Set<string>; onRename: (k: string) => void }) {
  const [draft, setDraft] = useState(value);
  const problem = draft === value ? null : !CONTENT_KEY.test(draft) ? 'Use lower-case words joined by dots' : taken.has(draft) ? 'Already used' : null;
  return (
    <div className="grid gap-1">
      <Input value={draft} onChange={(e) => setDraft(e.target.value.trim())} className="font-mono text-sm" aria-invalid={!!problem} aria-label="Name" />
      {problem ? <span className="text-xs text-destructive">{problem}</span> : null}
      <div>
        <Button type="button" size="sm" variant="outline" disabled={draft === value || !!problem} onClick={() => onRename(draft)}>
          Rename
        </Button>
      </div>
    </div>
  );
}

export function ContentEditor(props: EditorProps) {
  const { doc, update, selected, onSelect } = props;
  const advanced = useIsAdvanced();
  const { readOnly } = useStudio();
  const [search, setSearch] = useState('');
  const strings = asObj(doc.strings);
  const entries = Object.entries(strings).filter((e): e is [string, string] => typeof e[1] === 'string');
  const taken = useMemo(() => new Set(Object.keys(strings)), [strings]);
  const selectedKey = selected?.startsWith('strings/') ? selected.slice('strings/'.length) : null;

  const q = search.trim().toLowerCase();
  const shown = q ? entries.filter(([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q)) : entries;
  const groups = useMemo(() => {
    const m = new Map<string, [string, string][]>();
    for (const e of shown) {
      const g = e[0].includes('.') ? (e[0].split('.')[0] as string) : 'general';
      m.set(g, [...(m.get(g) ?? []), e]);
    }
    return [...m.entries()];
  }, [shown]);

  const setString = (k: string, v: string) => update((d) => updateIn(d, ['strings'], (cur) => ({ ...asObj(cur), [k]: v })) as Obj);

  function remove(k: string) {
    const old = strings[k];
    update((d) =>
      updateIn(d, ['strings'], (cur) => {
        const o = { ...asObj(cur) };
        delete o[k];
        return o;
      }) as Obj,
    );
    if (selectedKey === k) onSelect(null);
    toast(`Removed “${k}”`, { action: { label: 'Undo', onClick: () => setString(k, String(old ?? '')) } });
  }

  return (
    <div className="grid gap-4">
      <DocumentHeader doc={doc} update={update} showLocale />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the wording…" className="pl-8" aria-label="Search the wording" />
        </div>
        <span className="text-sm text-muted-foreground">
          {q ? `${shown.length} of ${entries.length}` : entries.length} text{entries.length === 1 ? '' : 's'}
        </span>
      </div>
      {!readOnly ? (
        <AddString
          taken={taken}
          onAdd={(k, t) => {
            setString(k, t);
            onSelect(`strings/${k}`);
          }}
        />
      ) : null}
      {groups.length === 0 ? <Hint>{q ? 'Nothing matches your search.' : readOnly ? 'No wording yet.' : 'No wording yet. Add the first text above.'}</Hint> : null}
      {groups.map(([group, rows]) => (
        <Card key={group} className="overflow-hidden">
          <div className="border-b px-4 py-2 text-sm font-semibold">
            {humanLabel(group)} <span className="font-normal text-muted-foreground">({rows.length})</span>
          </div>
          <ul className="divide-y">
            {rows.map(([k, v]) => {
              const isSel = selectedKey === k;
              const placeholders = templatePaths(v);
              const bad = !isValidTemplate(v);
              return (
                <li key={k} className={cn('grid gap-2 px-4 py-3 md:grid-cols-[minmax(12rem,1fr)_minmax(0,2.5fr)_auto]', isSel && 'bg-sky-50/60')}>
                  <div className="min-w-0">
                    {isSel && advanced && !readOnly ? (
                      <KeyEditor
                        value={k}
                        taken={taken}
                        onRename={(nk) => {
                          update((d) => updateIn(d, ['strings'], (cur) => renameKey(asObj(cur), k, nk)) as Obj);
                          onSelect(`strings/${nk}`);
                        }}
                      />
                    ) : advanced ? (
                      <code className="break-all text-sm text-muted-foreground">{k}</code>
                    ) : (
                      <span className="break-words text-sm text-muted-foreground">{humanLabel(k.includes('.') ? k.split('.').slice(1).join(' ') : k)}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    {isSel && !readOnly ? (
                      <Textarea autoFocus rows={Math.min(8, Math.max(2, Math.ceil(v.length / 70) + v.split('\n').length - 1))} value={v} onChange={(e) => setString(k, e.target.value)} aria-label={`Text for ${k}`} aria-invalid={bad} />
                    ) : (
                      <button type="button" className="w-full rounded-md p-1 text-left text-sm hover:bg-slate-100" onClick={() => onSelect(`strings/${k}`)}>
                        {v ? <Highlighted text={v} /> : <span className="italic text-muted-foreground">Empty</span>}
                      </button>
                    )}
                    {bad ? <p className="mt-1 text-xs text-destructive">A {'{{ }}'} isn’t closed, or a placeholder name isn’t allowed.</p> : null}
                    {isSel && placeholders.length > 0 ? (
                      <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        Filled in by the app:
                        {placeholders.map((p) => (
                          <Badge key={p} tone="info" className="font-mono">
                            {p}
                          </Badge>
                        ))}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-start justify-end gap-1">
                    {isSel ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => onSelect(null)}>
                        Done
                      </Button>
                    ) : null}
                    {!readOnly ? (
                      <IconAction label="Remove this text" destructive onClick={() => remove(k)}>
                        <Trash2 />
                      </IconAction>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
