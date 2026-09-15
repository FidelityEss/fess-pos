'use client';

// /help — the glossary for the few terms that can't be avoided (D-98, docs/17 §4.4), and where to find things: every
// screen the person can open, with its one-sentence purpose from the menu.
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { canAccess, NAV_GROUPS } from '@/components/shell/nav';
import { useIsAdvanced } from '@/lib/preferences';
import { useStaff } from '@/lib/staff';

/** The glossary. Plain words first; the older or technical name in brackets so people can match what others say. */
export const GLOSSARY: readonly { term: string; aka?: string; meaning: string }[] = [
  { term: 'Job', meaning: 'A request from a bank to visit one merchant. It stays open from booking the visit to the final approval.' },
  {
    term: 'Visit',
    aka: 'inspection',
    meaning: 'One trip by an agent to the merchant to answer the questions and take photos. A job usually has one visit; it has more when a visit is sent back or couldn’t be finished.',
  },
  { term: 'Agent', meaning: 'The Fidelity employee who goes to the merchant, using the FESS app on their phone.' },
  { term: 'Booking', aka: 'appointment', meaning: 'The visit time agreed with the merchant. A job needs a booking before it can go to an agent.' },
  {
    term: 'Pending, Assigned, In Progress, Completed, Cancelled, Unable to Complete',
    meaning: 'The six groups banks use to report on jobs. Each group covers a few more detailed statuses, which you see on each job.',
  },
  { term: 'Site area', aka: 'geofence', meaning: 'The circle around the merchant’s pin on the map. The agent must be inside it to start the visit.' },
  {
    term: 'Security checks',
    aka: 'integrity checks',
    meaning: 'Automatic checks that the photos and answers weren’t changed after they were taken, and that the phone and its location weren’t tampered with.',
  },
  {
    term: 'Delivery record',
    aka: 'chain of custody',
    meaning: 'The record of each photo and answer on its way from the agent’s phone to our systems, with times. It shows that nothing was lost or changed.',
  },
  {
    term: 'Draft, Published and Live',
    meaning: 'A draft is set-up you’re still working on. Publishing saves it as a numbered version that can no longer change. Making it live chooses which published version a bank’s agents use.',
  },
  { term: 'Second approval', aka: 'four-eyes', meaning: 'Some banks need a second person to approve important changes before they take effect. You can’t approve your own change.' },
  { term: 'Reasons', aka: 'reason codes', meaning: 'The fixed choices people pick when something happens, such as why a job was cancelled or why a visit was sent back.' },
  { term: 'Business type', aka: 'MCC', meaning: 'The card-industry code for the kind of business a merchant runs, such as a restaurant or a fuel station.' },
  { term: 'Archive', aka: 'close', meaning: 'Put a finished job away for good. Nothing more can happen to it.' },
  {
    term: 'Basic and Advanced view',
    meaning: 'Basic shows the everyday screens in plain words. Advanced also shows technical screens and details such as codes and raw data. Switch at the top of the page; it only changes what you see.',
  },
];

/** Help and glossary page. */
export function HelpView() {
  const staff = useStaff();
  const advanced = useIsAdvanced();
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canAccess(i.access, staff) && i.href !== '/help') })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <>
      <PageHeader title="Help and glossary" />
      <div className="grid gap-10 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section id="glossary" aria-labelledby="glossary-title" className="min-w-0">
          <h2 id="glossary-title" className="mb-1 text-lg font-semibold">
            Words you’ll see
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">Most of the panel uses everyday words. These few need a line of explanation.</p>
          <dl className="divide-y divide-divider border-y border-divider">
            {GLOSSARY.map((g) => (
              <div key={g.term} className="grid gap-1 py-3 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-4">
                <dt className="font-semibold">
                  {g.term}
                  {g.aka ? <span className="block text-sm font-normal text-muted-foreground">also called {g.aka}</span> : null}
                </dt>
                <dd className="text-base text-muted-foreground">{g.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="where-title" className="min-w-0">
          <h2 id="where-title" className="mb-1 text-lg font-semibold">
            Where to find things
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Every screen you can open, and what it’s for.{advanced ? '' : ' Screens marked “technical” show in the menu in Advanced view.'}
          </p>
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={g.label}>
                <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</h3>
                <ul className="divide-y divide-divider border-y border-divider">
                  {g.items.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className="group flex items-center gap-3 py-3 hover:bg-accent/40">
                        <item.icon className="size-5 shrink-0 text-primary" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">
                            {item.label}
                            {item.advanced ? <span className="ml-2 text-xs font-normal text-muted-foreground">technical</span> : null}
                          </span>
                          <span className="block text-sm text-muted-foreground">{item.description}</span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
