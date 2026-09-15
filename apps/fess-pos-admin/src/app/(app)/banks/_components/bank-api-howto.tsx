'use client';

// "How to connect" (T6-06, D-100 (5), B6.9): what a bank's developers need to call the bank API. Plain words first, then
// the address, the header, example calls, the fields, the cursor, the limits and the photo-link lifetime. The endpoints
// are the ones in supabase/functions/api/routes/bank.ts and bank-exports.ts; keep this in step with them and docs/03 §4.
import type { ReactNode } from 'react';
import { CopyButton } from '@/components/copy-button';
import { bankApiBase } from './bank-keys-data';

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 pr-10 font-mono text-xs leading-relaxed">{children}</pre>
      <CopyButton value={children} className="absolute right-2 top-2" title="Copy" />
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h4 className="font-medium text-foreground">
        {n}. {title}
      </h4>
      {children}
    </section>
  );
}

function Fields({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
      {rows.map(([name, meaning]) => (
        <div key={name} className="contents">
          <dt className="font-mono text-xs leading-5 text-foreground">{name}</dt>
          <dd className="text-muted-foreground">{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BankApiHowTo() {
  const base = bankApiBase();
  return (
    <div className="grid gap-5 text-sm text-foreground">
      <p className="text-muted-foreground">
        Send this to the bank’s developers with their key. Their system asks what has changed since it last asked, then reads each
        visit it hasn’t seen. It only ever sees this bank’s visits, and by default only those with a decision (approved or rejected).
      </p>

      <Step n={1} title="The address and the key">
        <p className="text-muted-foreground">Every request goes to this address, with the key in the Authorization header:</p>
        <Code>{base}</Code>
        <Code>{'Authorization: Bearer <the API key>'}</Code>
      </Step>

      <Step n={2} title="Ask what has changed">
        <Code>{`curl -s "${base}/inspections?limit=100" \\\n  -H "Authorization: Bearer $POS_BANK_KEY"`}</Code>
        <p className="text-muted-foreground">
          The answer lists visits oldest change first, with <code className="font-mono text-xs">has_more</code> and{' '}
          <code className="font-mono text-xs">next_cursor</code>. Keep the cursor and send it back next time as{' '}
          <code className="font-mono text-xs">since</code>; when nothing has changed you get no items and the same cursor. A visit shows up
          again if a reviewer corrects it later. <code className="font-mono text-xs">limit</code> is 1 to 500 (100 if left out).
        </p>
        <Code>{`curl -s "${base}/inspections?since=<next_cursor>&limit=100" \\\n  -H "Authorization: Bearer $POS_BANK_KEY"`}</Code>
        <Fields
          rows={[
            ['id', 'The visit. Use it to read the visit (step 3).'],
            ['job_reference, external_ref', 'Our job reference, and the bank’s own reference when it gave one.'],
            ['merchant_name, status, attempt', 'Who was visited, where the visit stands, and which try it was.'],
            ['submitted_at, changed_at', 'When the agent’s answers reached us, and when the visit last changed.'],
            ['decision', 'The review decision, its reason code and when it was made.'],
          ]}
        />
      </Step>

      <Step n={3} title="Read one visit">
        <Code>{`curl -s "${base}/inspections/<id>" \\\n  -H "Authorization: Bearer $POS_BANK_KEY"`}</Code>
        <Fields
          rows={[
            ['inspection', 'Status, times, and the fingerprints (SHA-256) that prove what was submitted.'],
            ['job', 'Reference, merchant, trading name, address and business type.'],
            ['decision', 'The review decision.'],
            ['form', 'Which form the agent filled in, and its version.'],
            ['answers[]', 'Each answer in form order: section, label, key, value, value_label for choices, evidence_ids for photos, and source (agent, prefilled or computed).'],
            ['amendments[]', 'Corrections a reviewer made after submission: the field, old and new values, the reason and when.'],
            ['custody', 'How many photos were expected, received, checked and backed up, and the chain-of-custody events.'],
            ['evidence[]', 'Each photo or file: id, question, type, size, when it was taken, its SHA-256, and a download url.'],
          ]}
        />
        <p className="text-muted-foreground">
          Photo links (<code className="font-mono text-xs">url</code>) work for 15 minutes; <code className="font-mono text-xs">url_expires_at</code>{' '}
          says when. Read the visit again for fresh links. Check each photo you download against its <code className="font-mono text-xs">sha256</code>.
        </p>
      </Step>

      <Step n={4} title="Or ask for a whole file">
        <p className="text-muted-foreground">
          For many visits at once, ask for an export: <code className="font-mono text-xs">csv</code> or{' '}
          <code className="font-mono text-xs">xlsx</code> for the answers, <code className="font-mono text-xs">evidence_zip</code> for the photos with a
          manifest of their fingerprints. The dates are when the visits reached us, and <code className="font-mono text-xs">form</code> (optional) is
          the form’s key. It’s prepared in the background.
        </p>
        <Code>{`curl -s -X POST "${base}/exports" \\\n  -H "Authorization: Bearer $POS_BANK_KEY" -H "Content-Type: application/json" \\\n  -d '{"format": "csv", "from": "2026-09-01", "to": "2026-09-30"}'`}</Code>
        <p className="text-muted-foreground">Then check on it with the id you got back, every minute or so:</p>
        <Code>{`curl -s "${base}/exports/<id>" \\\n  -H "Authorization: Bearer $POS_BANK_KEY"`}</Code>
        <Fields
          rows={[
            ['status', 'queued, preparing, ready or failed. Only ready has a file.'],
            ['will_retry, error', 'When something went wrong: what, and whether we try again by ourselves.'],
            ['file', 'When ready: name, type, size, its SHA-256, and a url that works for 15 minutes. Each check gives a fresh link.'],
            ['visits, photos', 'How many visits and photos the file holds.'],
            ['expires_at', 'After this the file can’t be downloaded; ask again.'],
          ]}
        />
      </Step>

      <Step n={5} title="Limits and errors">
        <p className="text-muted-foreground">
          Each key may make a set number of requests a minute. Every answer says the limit in{' '}
          <code className="font-mono text-xs">x-ratelimit-limit</code> and what’s left in <code className="font-mono text-xs">x-ratelimit-remaining</code>.
          Over the limit you get 429 with <code className="font-mono text-xs">retry_after_s</code>. Errors come as{' '}
          <code className="font-mono text-xs">{'{"error": {"code", "message", "retryable"}}'}</code>: try again only when{' '}
          <code className="font-mono text-xs">retryable</code> is true. A key that has expired or been switched off gets 401.
        </p>
        <p className="text-muted-foreground">
          Every call is recorded, with the key, the time and the result. The most recent ones are listed below.
        </p>
      </Step>
    </div>
  );
}
