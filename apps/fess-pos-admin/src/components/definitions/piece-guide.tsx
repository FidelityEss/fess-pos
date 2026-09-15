'use client';

// The top of a piece's page (docs/17 §2 rules 2–3, §4.6): what this piece is, who fills it in and when, how it connects
// to the other pieces (with links), where it stands in plain words ("Draft", "Live for Bank ABC") and the obvious next
// step.
import { Link2, UserRound } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import type { DefinitionFamily } from '@/lib/types';
import { KIND_DESCRIPTION, KIND_ICON, KIND_SINGULAR, KIND_WHO } from './definitions-data';
import type { PieceStatus } from './set-up-status';
import { useStudioRefs } from './studio/bundle';
import { asObj, asStr } from './studio/doc';

interface Connection {
  text: ReactNode;
}

function PieceLink({ id, children }: { id?: string; children: ReactNode }) {
  return id ? (
    <Link href={`/definitions/${id}`} className="font-medium text-primary hover:underline">
      {children}
    </Link>
  ) : (
    <span className="font-medium">{children}</span>
  );
}

function joinLinks(items: { id?: string; title: string }[]): ReactNode {
  return items.map((it, i) => (
    <span key={`${it.title}-${i}`}>
      {i > 0 ? (i === items.length - 1 ? ' and ' : ', ') : null}
      <PieceLink id={it.id}>{it.title}</PieceLink>
    </span>
  ));
}

/** How this piece connects to the others, from the published pieces in the same scope. */
function useConnections(family: DefinitionFamily): Connection[] {
  const refs = useStudioRefs(family);
  const flows = refs.families.flow;
  const forms = refs.families.form;
  switch (family.kind) {
    case 'form': {
      const using = flows.filter((fl) => asStr(asObj(refs.bundle.flows?.[fl.key]).form_family) === family.key);
      return [
        {
          text: using.length ? (
            <>Asked during the visit steps {joinLinks(using)}.</>
          ) : (
            <>No published visit steps ask these questions yet. Choose them at the top of the visit steps.</>
          ),
        },
        { text: <>A question can show only when an earlier answer, or the job information, says so.</> },
      ];
    }
    case 'flow':
      return [{ text: <>Its Questions steps show sections of the questions chosen at the top{forms.length ? <> (for example {joinLinks(forms.slice(0, 2))})</> : null}.</> }];
    case 'job_schema':
      return [
        { text: <>Shown on the new-job form and in the spreadsheet import, after the details every job has.</> },
        { text: <>The job page on the phone shows it, and questions can depend on it (for example, ask for more photos when the risk is high).</> },
      ];
    case 'app':
      return [{ text: <>Its pages show screen layouts, and a button or tab can start the visit steps.</> }];
    case 'view':
      return [{ text: <>A page of the app screens shows this layout. The job page, the home page and the job cards are layouts.</> }];
    case 'content':
      return [{ text: <>Used on every screen of the app. A bank’s own wording replaces the shared wording for its agents.</> }];
    default:
      return [];
  }
}

export function PieceGuide({ family, statuses, forLabel, next }: { family: DefinitionFamily; statuses: PieceStatus[]; forLabel: string; next?: ReactNode }) {
  const Icon = KIND_ICON[family.kind];
  const connections = useConnections(family);
  return (
    <div className="mb-5 grid gap-4 rounded-lg border bg-card p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1.5 text-sm">
          <p>
            <span className="font-semibold">{KIND_SINGULAR[family.kind]}</span> <span className="text-muted-foreground">· {forLabel}</span>
          </p>
          <p>{KIND_DESCRIPTION[family.kind]}</p>
          <p className="flex items-start gap-1.5 text-muted-foreground">
            <UserRound className="mt-0.5 size-4 shrink-0" aria-hidden /> {KIND_WHO[family.kind]}
          </p>
          {connections.map((c, i) => (
            <p key={i} className="flex items-start gap-1.5 text-muted-foreground">
              <Link2 className="mt-0.5 size-4 shrink-0" aria-hidden /> <span>{c.text}</span>
            </p>
          ))}
        </div>
      </div>
      <div className="grid content-start gap-2 border-t pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
        <p className="text-sm font-medium text-muted-foreground">Where it stands</p>
        <ul className="flex flex-wrap gap-1.5">
          {statuses.map((s) => (
            <li key={s.label}>
              <Badge tone={s.tone} className="text-sm">
                {s.label}
              </Badge>
              {s.hint ? <span className="ml-1 text-xs text-muted-foreground">{s.hint}</span> : null}
            </li>
          ))}
        </ul>
        {next ? <div className="flex flex-wrap items-center gap-2 text-sm">{next}</div> : null}
      </div>
    </div>
  );
}
