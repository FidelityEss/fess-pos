'use client';

// "How the set-up fits together" (docs/17 §4.6, B4.25): a picture of the pieces in the order a visit meets them —
// the office's job information, then the visit steps and the questions they ask, then what the agent sees around the
// visit (app screens, screen layouts, wording). Each piece says who fills it in, shows where it stands and opens its
// editor.
import { ArrowDown, ArrowRight, ChevronRight, Plus, UserRound } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { DefinitionFamily, DefinitionKind } from '@/lib/types';
import { cn } from '@/lib/utils';
import { KIND_DESCRIPTION, KIND_ICON, KIND_LABEL, KIND_WHO } from './definitions-data';
import type { PieceStatus } from './set-up-status';
import { stepWording } from './studio/catalogue-ui';

export interface MapEntry {
  family: DefinitionFamily;
  /** Who it's for, e.g. "All banks" or the bank's name. */
  forLabel: string;
  statuses: PieceStatus[];
}

const SHOWN_PER_PIECE = 3;

/** A typical visit, to show where the questions sit among the steps. */
const EXAMPLE_JOURNEY = ['job_briefing', 'location_check', 'form', 'summary_review', 'declaration', 'submit'] as const;

function PieceCard({
  kind,
  entries,
  canAdd,
  onAdd,
  children,
}: {
  kind: DefinitionKind;
  entries: MapEntry[];
  canAdd: boolean;
  onAdd: (kind: DefinitionKind) => void;
  children?: ReactNode;
}) {
  const Icon = KIND_ICON[kind];
  const shown = entries.slice(0, SHOWN_PER_PIECE);
  const more = entries.length - shown.length;
  return (
    <section aria-label={KIND_LABEL[kind]} className="flex h-full flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex items-start gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-tight">{KIND_LABEL[kind]}</h3>
          <p className="text-sm text-muted-foreground">{KIND_DESCRIPTION[kind]}</p>
        </div>
      </div>
      <p className="flex items-start gap-1.5 text-sm text-foreground">
        <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        {KIND_WHO[kind]}
      </p>
      {children}
      <div className="mt-auto grid gap-1 border-t pt-2">
        {entries.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge tone="muted">Not set up yet</Badge>
            {canAdd ? (
              <Button type="button" size="sm" variant="outline" onClick={() => onAdd(kind)}>
                <Plus /> Set it up
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="grid gap-1">
            {shown.map(({ family, forLabel, statuses }) => (
              <li key={family.id}>
                <Link
                  href={`/definitions/${family.id}`}
                  className="group flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1.5 py-1 text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 font-medium group-hover:underline">{family.title}</span>
                  <span className="text-xs text-muted-foreground">{forLabel}</span>
                  <span className="ml-auto flex flex-wrap items-center gap-1">
                    {statuses.slice(0, 2).map((s) => (
                      <Badge key={s.label} tone={s.tone} title={s.hint}>
                        {s.label}
                      </Badge>
                    ))}
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
            {more > 0 ? (
              <li>
                <a href={`#kind-${kind}`} className="px-1.5 text-sm text-primary hover:underline">
                  and {more} more
                </a>
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </section>
  );
}

/** An arrow between pieces with a few words saying what passes along it. Horizontal on wide screens. */
function Connector({ label, direction = 'auto' }: { label: string; direction?: 'auto' | 'down' }) {
  return (
    <div className={cn('flex items-center justify-center gap-1.5 text-xs text-muted-foreground', direction === 'auto' && 'lg:flex-col')} aria-hidden>
      {direction === 'auto' ? <ArrowRight className="hidden size-5 lg:block" /> : null}
      <ArrowDown className={cn('size-5', direction === 'auto' && 'lg:hidden')} />
      <span className={cn(direction === 'auto' && 'lg:max-w-20 lg:text-center')}>{label}</span>
    </div>
  );
}

function LaneTitle({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

export function SetUpMap({ entries, canAdd, onAdd }: { entries: Record<DefinitionKind, MapEntry[]>; canAdd: boolean; onAdd: (kind: DefinitionKind) => void }) {
  const card = (kind: DefinitionKind, children?: ReactNode) => (
    <PieceCard kind={kind} entries={entries[kind]} canAdd={canAdd} onAdd={onAdd}>
      {children}
    </PieceCard>
  );
  return (
    <figure aria-labelledby="set-up-map-title" className="rounded-lg border bg-card p-4">
      <figcaption>
        <h2 id="set-up-map-title" className="text-lg font-semibold">
          How the set-up fits together
        </h2>
        <p className="text-sm text-muted-foreground">Follow a visit from the office to the agent’s phone. Each box shows where that part stands and opens it.</p>
      </figcaption>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1.6fr)]">
        <div className="grid content-start gap-2">
          <LaneTitle>1. Before the visit</LaneTitle>
          {card('job_schema')}
        </div>
        <Connector label="The job goes to an agent" />
        <div className="grid content-start gap-2">
          <LaneTitle>2. During the visit</LaneTitle>
          {card(
            'flow',
            <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="A typical visit">
              {EXAMPLE_JOURNEY.map((t, i) => (
                <li key={t} className="flex items-center gap-1">
                  <span className={cn('rounded-full border px-2 py-0.5', t === 'form' ? 'border-primary bg-primary/10 font-medium text-primary' : 'bg-card text-muted-foreground')}>
                    {stepWording(t).name}
                  </span>
                  {i < EXAMPLE_JOURNEY.length - 1 ? <ChevronRight className="size-3 text-muted-foreground" aria-hidden /> : null}
                </li>
              ))}
            </ol>,
          )}
          <Connector label="The Questions step asks these" direction="down" />
          {card('form')}
        </div>
      </div>

      <div className="mt-5 grid gap-2 border-t pt-4">
        <LaneTitle>3. Around the visit, on the agent’s phone</LaneTitle>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)_minmax(0,1fr)]">
          {card('app')}
          <Connector label="Each screen is laid out by" />
          {card('view')}
          {card('content')}
        </div>
      </div>
    </figure>
  );
}
