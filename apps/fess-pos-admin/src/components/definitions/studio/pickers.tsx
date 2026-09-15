'use client';

// Pickers shared by the flow, view and app editors: a described-choice dialog ("add a step / item / page") and a
// target field (open a page or start a flow).
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { asObj, asStr } from './doc';
import { SelectField } from './shared';

export interface Choice {
  value: string;
  name: string;
  description: string;
  icon: LucideIcon;
  group?: string;
}

export function ChoiceDialog({
  open,
  onOpenChange,
  title,
  description,
  choices,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  choices: Choice[];
  onPick: (value: string) => void;
}) {
  const groups = [...new Set(choices.map((c) => c.group ?? ''))];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
          {groups.map((g) => (
            <section key={g || 'all'}>
              {g ? <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{g}</h3> : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {choices
                  .filter((c) => (c.group ?? '') === g)
                  .map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => {
                        onPick(c.value);
                        onOpenChange(false);
                      }}
                      className="flex items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                        <c.icon className="size-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-base font-medium">{c.name}</span>
                        <span className="block text-sm text-muted-foreground">{c.description}</span>
                      </span>
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Controlled open state helper. */
export function useDialog(): [boolean, (o: boolean) => void] {
  return useState(false);
}

/** `{ page }` / `{ flow }` target as one select: "Open page: Job detail" / "Start the visit steps: Site inspection". */
export function TargetField({
  label,
  hint,
  value,
  onChange,
  pages,
  flows,
  allowNone = true,
}: {
  label: string;
  hint?: string;
  value: unknown;
  onChange: (v: unknown) => void;
  pages: { key: string; title: string }[];
  flows: { key: string; title: string }[];
  allowNone?: boolean;
}) {
  const o = asObj(value);
  const current = typeof o.page === 'string' ? `page:${o.page}` : typeof o.flow === 'string' ? `flow:${o.flow}` : undefined;
  const options = [
    ...pages.map((p) => ({ value: `page:${p.key}`, label: `Open page: ${p.title}` })),
    ...flows.map((f) => ({ value: `flow:${f.key}`, label: `Start the visit steps: ${f.title}` })),
  ];
  return (
    <SelectField
      label={label}
      hint={hint}
      value={current}
      unsetLabel={allowNone ? 'Nothing (can’t be tapped)' : undefined}
      options={options}
      onChange={(v) => {
        if (!v) return onChange(undefined);
        const [kind, ...rest] = v.split(':');
        const key = rest.join(':');
        // keep any other properties the target carried
        const { page: _p, flow: _f, ...others } = o;
        void _p;
        void _f;
        onChange(kind === 'flow' ? { ...others, flow: key } : { ...others, page: key });
      }}
    />
  );
}

/** "Open page: Job detail" for display. */
export function targetText(value: unknown, pageTitle: (k: string) => string = (k) => k): string {
  const o = asObj(value);
  if (typeof o.page === 'string') return `opens ${pageTitle(asStr(o.page))}`;
  if (typeof o.flow === 'string') return 'starts the visit steps';
  return '';
}
