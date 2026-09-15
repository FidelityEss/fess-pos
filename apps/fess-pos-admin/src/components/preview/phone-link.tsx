'use client';

// "Preview on a phone" (T3-12, D-101, docs/04 §10): a short-lived link that opens this draft in the FESS app on a phone,
// signed in as an agent or tester, in the app's preview mode, where nothing is kept. The server makes the link
// (POST /v1/admin/preview-links); the phone fetches the draft with it (GET /v1/preview/:token). Each link is also shown
// as a QR code (qrcode.react, drawn as SVG in the browser: the link never leaves the page), to scan with the phone.
import { Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { CopyButton } from '@/components/copy-button';
import { Details } from '@/components/details';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useIsAdvanced } from '@/lib/preferences';
import type { ModulePreviewRequest } from './module-preview-bridge';

interface PreviewLink {
  id: string;
  token: string;
  path: string;
  links: Record<string, string>;
  expires_at: string;
}

const PLATFORM: Record<string, string> = { android: 'Android phones', ios: 'iPhones' };

export function PhoneLinkButton({
  request,
  familyId,
  bankId,
  className,
}: {
  request: ModulePreviewRequest | null;
  /** The draft's family, when it has one: its bank decides who may make the link. */
  familyId?: string | null;
  /** A bank's own preview without a family. */
  bankId?: string | null;
  className?: string;
}) {
  const advanced = useIsAdvanced();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<PreviewLink | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function make() {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      setLink(await api<PreviewLink>('POST', '/v1/admin/preview-links', { ...request, family_id: familyId ?? null, bank_id: bankId ?? null }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const until = link ? new Date(link.expires_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={className}
        disabled={!request}
        onClick={() => {
          setOpen(true);
          setLink(null);
          void make();
        }}
      >
        <Smartphone /> Preview on a phone
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Preview on a phone</DialogTitle>
            <DialogDescription>
              Open this link on a phone with the FESS app, signed in as an agent or a tester. It shows this draft as it is now, and nothing done
              there is kept.
            </DialogDescription>
          </DialogHeader>
          {error ? <ApiErrorAlert error={error} onRetry={() => void make()} /> : null}
          {busy ? <p className="text-sm text-muted-foreground">Making the link…</p> : null}
          {link ? (
            <div className="space-y-3 text-sm">
              <p>
                The link works until <b>{until}</b>. Scan its code with the phone’s camera, or send the link to the phone, for example by email
                or in a chat. Changed the draft since? Make a new link.
              </p>
              <ul className="space-y-2">
                {Object.entries(link.links).map(([platform, url]) => (
                  <li key={platform} className="flex items-start gap-3 rounded-md border p-2">
                    <QRCodeSVG
                      value={url}
                      size={112}
                      level="M"
                      marginSize={2}
                      bgColor="#ffffff"
                      fgColor="#000000"
                      title={`Code for ${PLATFORM[platform] ?? platform}: scan it with the phone’s camera`}
                      className="shrink-0 rounded-sm border"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{PLATFORM[platform] ?? platform}</span>
                        <CopyButton value={url} label="Copy link" variant="outline" />
                      </div>
                      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{url}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                If the link does nothing on a phone, the FESS app there doesn’t open POS links yet. That is set up in the FESS app, not here.
              </p>
              {advanced ? (
                <Details className="text-xs">
                  <p>
                    Path the app opens: <span className="font-mono">{link.path}</span>
                  </p>
                  <p>Only a fingerprint of the link is kept on the server; the link itself can’t be shown again.</p>
                </Details>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
