'use client';

// Content preview (T3-23): each string as the phone (or the verify page / email) shows it, placeholders filled with
// sample values. Grouped by key prefix; the search box lives in the preview toolbar.
import { CircleAlert, CircleCheck, CloudUpload, Inbox, Mail, MapPin, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SAMPLE_PLACEHOLDER_VALUES } from './fallback-strings';
import { PreviewNotice } from './phone-widgets';
import { fillPlaceholders, humanise } from './preview-format';

const GROUP_LABEL: Record<string, string> = {
  jobs: 'Lists',
  sync: 'Sync status',
  receipt: 'Receipts',
  location: 'Location check',
  update: 'App updates',
  notify: 'Emails',
  verify: 'Verification page (web)',
};

function Snippet({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div>
      {children}
      <div className="mt-1 truncate font-mono text-[12px] text-slate-400">{caption}</div>
    </div>
  );
}

function renderString(key: string, text: string): ReactNode {
  const [group] = key.split('.');
  if (group === 'sync') {
    const Icon = key.endsWith('synced') ? CircleCheck : key.endsWith('needs_attention') ? CircleAlert : CloudUpload;
    const tone = key.endsWith('synced') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : key.endsWith('needs_attention') ? 'border-red-200 bg-red-50 text-red-800' : 'border-sky-200 bg-sky-50 text-sky-800';
    return (
      <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium', tone)}>
        <Icon className="size-4" /> {text}
      </span>
    );
  }
  if (group === 'receipt') {
    const ok = key.endsWith('received');
    return (
      <div className={cn('flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[15px]', ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-sky-200 bg-sky-50 text-sky-900')}>
        {ok ? <CircleCheck className="mt-0.5 size-5 shrink-0" /> : <CloudUpload className="mt-0.5 size-5 shrink-0" />}
        <span>{text}</span>
      </div>
    );
  }
  if (group === 'location' || group === 'update') {
    const warn = key.includes('outside') || group === 'update';
    return (
      <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[14px]', warn ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-sky-200 bg-sky-50 text-sky-900')}>
        {warn ? <TriangleAlert className="mt-0.5 size-4 shrink-0" /> : <MapPin className="mt-0.5 size-4 shrink-0" />}
        <span>{text}</span>
      </div>
    );
  }
  if (group === 'jobs') {
    return (
      <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-center text-[14px] text-slate-500">
        <Inbox className="size-6" />
        {text}
      </div>
    );
  }
  if (group === 'verify') {
    const heading = key.endsWith('heading') || key.endsWith('title');
    const bad = key.includes('invalid');
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        {heading ? (
          <div className={cn('flex items-center gap-1.5 text-[17px] font-semibold', bad ? 'text-red-700' : 'text-emerald-800')}>
            {bad ? <CircleAlert className="size-5" /> : <ShieldCheck className="size-5" />} {text}
          </div>
        ) : (
          <p className="text-[14px] leading-snug text-slate-700">{text}</p>
        )}
      </div>
    );
  }
  return <div className="whitespace-pre-line rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] leading-snug text-slate-800">{text}</div>;
}

/** The strings as phone snippets. `query` filters by key or text. */
export function ContentSnippets({ strings, query = '' }: { strings: Readonly<Record<string, string>>; query?: string }) {
  const q = query.trim().toLowerCase();
  const fill = (s: string) => fillPlaceholders(s, SAMPLE_PLACEHOLDER_VALUES);
  const keys = Object.keys(strings)
    .filter((k) => !q || k.toLowerCase().includes(q) || (strings[k] ?? '').toLowerCase().includes(q))
    .sort();
  if (keys.length === 0) {
    return (
      <div className="p-3">
        <PreviewNotice>{Object.keys(strings).length === 0 ? 'No strings in this content definition yet.' : 'No strings match the search.'}</PreviewNotice>
      </div>
    );
  }
  const groups = new Map<string, string[]>();
  for (const k of keys) {
    const g = k.split('.')[0] ?? k;
    groups.set(g, [...(groups.get(g) ?? []), k]);
  }
  return (
    <div className="space-y-5 px-3 py-3">
      {[...groups.entries()].map(([group, groupKeys]) => {
        const rendered: ReactNode[] = [];
        const done = new Set<string>();
        for (const k of groupKeys) {
          if (done.has(k)) continue;
          const email = /^(notify\..+\.email)\.(subject|body)$/.exec(k);
          if (email) {
            const base = email[1] ?? '';
            const subject = strings[`${base}.subject`];
            const body = strings[`${base}.body`];
            done.add(`${base}.subject`);
            done.add(`${base}.body`);
            rendered.push(
              <Snippet key={base} caption={base}>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-900">
                    <Mail className="size-4 text-slate-500" /> {subject !== undefined ? fill(subject) : '(no subject)'}
                  </div>
                  {body !== undefined ? <p className="mt-1.5 whitespace-pre-line text-[14px] leading-snug text-slate-700">{fill(body)}</p> : null}
                </div>
              </Snippet>,
            );
            continue;
          }
          done.add(k);
          rendered.push(
            <Snippet key={k} caption={k}>
              {renderString(k, fill(strings[k] ?? ''))}
            </Snippet>,
          );
        }
        return (
          <section key={group}>
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{GROUP_LABEL[group] ?? humanise(group)}</h3>
            <div className="space-y-3">{rendered}</div>
          </section>
        );
      })}
    </div>
  );
}
