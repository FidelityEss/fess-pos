'use client';

// Top card of every structured editor: the document's title and description (and kind-specific settings passed as
// children). Advanced view also shows the technical header (family key, spec version, document version, locale).
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useIsAdvanced } from '@/lib/preferences';
import { asStr, setProp } from './doc';
import { TextField, type Update } from './shared';

export function DocumentHeader({
  doc,
  update,
  children,
  showLocale = false,
  titleLabel = 'Title',
}: {
  doc: Record<string, unknown>;
  update: Update;
  children?: ReactNode;
  showLocale?: boolean;
  titleLabel?: string;
}) {
  const advanced = useIsAdvanced();
  const set = (k: string, v: string) => update((d) => setProp(d, [], k, v) as Record<string, unknown>);
  return (
    <Card>
      <CardContent className="grid gap-4 p-4">
        <div className={advanced || asStr(doc.description) ? 'grid gap-4 md:grid-cols-2' : 'grid gap-4 md:max-w-2xl'}>
          <TextField label={titleLabel} value={asStr(doc.title)} onChange={(v) => set('title', v)} placeholder="Shown in the admin panel, and to agents on some screens" />
          {advanced || asStr(doc.description) ? (
            <TextField label="Description" value={asStr(doc.description)} onChange={(v) => set('description', v)} placeholder="Optional" />
          ) : null}
        </div>
        {children}
        {advanced ? (
          <div className="grid gap-4 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="text-sm">
              <p className="text-xs text-muted-foreground">Technical name</p>
              <code className="text-sm">{asStr(doc.family) || '—'}</code>
            </div>
            <div className="text-sm">
              <p className="text-xs text-muted-foreground">Spec version</p>
              <code className="text-sm">{asStr(doc.spec_version) || '—'}</code>
            </div>
            <div className="text-sm">
              <p className="text-xs text-muted-foreground">Document version</p>
              <code className="text-sm">{typeof doc.version === 'number' ? doc.version : '—'}</code>
            </div>
            {showLocale || asStr(doc.locale) ? (
              <TextField label="Locale" value={asStr(doc.locale)} onChange={(v) => set('locale', v)} placeholder="en-ZA" mono />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
