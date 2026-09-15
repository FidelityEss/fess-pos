'use client';

// What happened to a registration link (emailed, or made for copying), and the link itself with Copy link (D-96).
import { MailCheck, MailWarning } from 'lucide-react';
import { CopyButton } from '@/components/copy-button';
import { DateTime } from '@/components/date-time';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { EMAIL_PROBLEM, type LinkResult } from './invitations';

/** The link's address without its token, for display: the full link only ever goes to the clipboard. */
function shortLink(link: string): string {
  try {
    const url = new URL(link);
    return `${url.origin}${url.pathname}?…`;
  } catch {
    return 'Registration link';
  }
}

export function LinkPanel({ result, name, kind }: { result: LinkResult; name: string; kind: 'sent' | 'resent' | 'copied' }) {
  const replaced = kind === 'resent' ? ' The earlier link no longer works.' : '';
  return (
    <div className="grid gap-4">
      {kind === 'copied' ? (
        <p className="text-sm">
          This is the link {name} was sent. Copying it doesn’t change it, so the emailed link keeps working too.
        </p>
      ) : result.email_sent ? (
        <Alert variant="success">
          <MailCheck />
          <AlertTitle>Emailed to {result.invitation.email}</AlertTitle>
          <AlertDescription>
            {replaced.trim()} If it doesn’t arrive in a few minutes, copy the link below and send it yourself.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="warning">
          <MailWarning />
          <AlertTitle>The link is ready, but it wasn’t emailed</AlertTitle>
          <AlertDescription>
            {EMAIL_PROBLEM[result.email_error ?? 'failed']} Copy the link below and send it to {name} yourself, for example from
            your own email.{replaced}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Registration link for {result.invitation.email}</span>
        <div className="flex items-center gap-2 rounded-md border px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{shortLink(result.link)}</span>
          <CopyButton value={result.link} label="Copy link" variant="outline" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        It works once, until <DateTime value={result.invitation.expires_at} />. Whoever has it can set up this account until
        then, so send it only to {name}.
      </p>
    </div>
  );
}
