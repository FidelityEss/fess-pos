'use client';

// Content preview (T3-23): each string as the phone (or the verify page / email) shows it, placeholders filled with
// sample values, in the module's look (docs/14 §2, D-97): the sync line as small grey text, receipts as chips, notices as
// tints, everything else on white with a light border. Grouped by key prefix; the search box lives in the preview toolbar.
import { CircleAlert, Mail, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SAMPLE_PLACEHOLDER_VALUES } from './fallback-strings';
import { PhoneChip } from './phone-frame';
import { PAGE_X, toneColors, typeStyle } from './phone-style';
import { Callout, PreviewNotice } from './phone-widgets';
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

/** A white box with a light border, 8 px corners (text on a web page or in an email). */
const BOX = 'rounded-[var(--ph-inner-r)] border border-[color:var(--ph-border)] bg-[color:var(--ph-page)] px-3 py-2.5';

function Snippet({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div>
      {children}
      <div className="mt-1 truncate font-mono text-[12px] text-[color:var(--ph-muted)]">{caption}</div>
    </div>
  );
}

function renderString(key: string, text: string): ReactNode {
  const [group] = key.split('.');
  if (group === 'sync') {
    // The module's sync line: small grey text, centred; what needs attention in error red.
    const attention = key.endsWith('needs_attention');
    return (
      <div className={cn('text-center', attention ? 'text-[color:var(--ph-error-text)]' : 'text-[color:var(--ph-body)]')} style={typeStyle(attention ? 'body' : 'caption')}>
        {text}
      </div>
    );
  }
  if (group === 'receipt') {
    return <PhoneChip tone={key.endsWith('received') ? 'success' : 'warning'}>{text}</PhoneChip>;
  }
  if (group === 'location' || group === 'update') {
    const warn = key.includes('outside') || group === 'update';
    return <Callout tone={warn ? 'warning' : 'info'}>{text}</Callout>;
  }
  if (group === 'jobs') {
    // An empty list: the message centred on the page.
    return (
      <div className="py-2 text-center text-[color:var(--ph-body)]" style={typeStyle('body')}>
        {text}
      </div>
    );
  }
  if (group === 'verify') {
    const heading = key.endsWith('heading') || key.endsWith('title');
    const bad = key.includes('invalid');
    return (
      <div className={BOX}>
        {heading ? (
          <div className="flex items-center gap-1.5" style={{ ...typeStyle('title'), color: toneColors(bad ? 'danger' : 'success').foreground }}>
            {bad ? <CircleAlert className="size-5 shrink-0" /> : <ShieldCheck className="size-5 shrink-0" />} {text}
          </div>
        ) : (
          <p className="text-[14px] font-medium leading-snug text-[color:var(--ph-body)]">{text}</p>
        )}
      </div>
    );
  }
  return (
    <div className={cn(BOX, 'whitespace-pre-line leading-snug text-[color:var(--ph-body)]')} style={typeStyle('body')}>
      {text}
    </div>
  );
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
      <div className={cn(PAGE_X, 'py-4')}>
        <PreviewNotice>{Object.keys(strings).length === 0 ? 'No wording yet.' : 'Nothing matches your search.'}</PreviewNotice>
      </div>
    );
  }
  const groups = new Map<string, string[]>();
  for (const k of keys) {
    const g = k.split('.')[0] ?? k;
    groups.set(g, [...(groups.get(g) ?? []), k]);
  }
  return (
    <div className={cn('space-y-6 py-4', PAGE_X)}>
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
                <div className={BOX}>
                  <div className="flex items-center gap-1.5 text-[14px] font-semibold text-[color:var(--ph-text)]">
                    <Mail className="size-4 shrink-0 text-[color:var(--ph-body)]" /> {subject !== undefined ? fill(subject) : '(no subject)'}
                  </div>
                  {body !== undefined ? <p className="mt-1.5 whitespace-pre-line text-[14px] leading-snug text-[color:var(--ph-body)]">{fill(body)}</p> : null}
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
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[color:var(--ph-body)]">{GROUP_LABEL[group] ?? humanise(group)}</h3>
            <div className="space-y-3">{rendered}</div>
          </section>
        );
      })}
    </div>
  );
}
