'use client';

// Dev-only gallery of phone previews (T3-23): every active global definition rendered by <DefinitionPreview>, with the
// bundle built from the others, so each kind can be checked at a glance. Inherits the /dev-tools access rule.
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ReadOnlyNotice } from '@/components/admin/admin-ui';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { PageHeader } from '@/components/page-header';
import { DefinitionPreview } from '@/components/preview/definition-preview';
import { usePreviewBundle } from '@/components/preview/preview-data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { env } from '@/lib/env';
import type { DefinitionKind } from '@/lib/types';
import { cn } from '@/lib/utils';

const KIND_ORDER: DefinitionKind[] = ['app', 'flow', 'form', 'view', 'content', 'job_schema'];
const KIND_TITLE: Record<DefinitionKind, string> = { app: 'App', flow: 'Flows', form: 'Forms', view: 'Views', content: 'Content', job_schema: 'Job schemas' };

export default function PreviewGalleryPage() {
  const { bundle, rows, isPending, error } = usePreviewBundle();
  const [kind, setKind] = useState<DefinitionKind | 'all'>('all');
  const [focus, setFocus] = useState('');
  const groups = useMemo(
    () => KIND_ORDER.map((k) => ({ kind: k, rows: rows.filter((r) => r.kind === k).sort((a, b) => a.key.localeCompare(b.key)) })).filter((g) => g.rows.length > 0),
    [rows],
  );

  if (env.isProduction) {
    return (
      <>
        <PageHeader title="Phone preview gallery" />
        <ReadOnlyNotice title="Not available in production">Dev tools exist only in local and staging environments.</ReadOnlyNotice>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Phone preview gallery"
        description="Every active global definition drawn by the phone preview, with the others as its bundle. Tap and type in the phones — rules and checks run through the shared engine."
      />
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <Button asChild variant="outline" size="sm">
          <Link href="/dev-tools">
            <ArrowLeft /> Dev tools
          </Link>
        </Button>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kind">
          {(['all', ...KIND_ORDER] as const).map((k) => (
            <Button key={k} size="sm" variant={kind === k ? 'default' : 'outline'} onClick={() => setKind(k)}>
              {k === 'all' ? 'All kinds' : KIND_TITLE[k]}
            </Button>
          ))}
        </div>
        <div className="grid gap-1">
          <Label htmlFor="gallery-focus">Focus element</Label>
          <Input id="gallery-focus" className="h-8 w-56" placeholder="section, field, step or page key" value={focus} onChange={(e) => setFocus(e.target.value.trim())} />
        </div>
      </div>

      <ApiErrorAlert error={error} />
      {isPending ? (
        <div className="grid gap-6 [grid-template-columns:repeat(auto-fill,minmax(24rem,1fr))]">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[44rem] w-full" />
          ))}
        </div>
      ) : error ? null : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No global definitions found in this database.</p>
      ) : (
        <div className="space-y-10">
          {groups
            .filter((g) => kind === 'all' || g.kind === kind)
            .map((g) => (
              <section key={g.kind} aria-labelledby={`kind-${g.kind}`}>
                <h2 id={`kind-${g.kind}`} className="mb-3 text-lg font-semibold">
                  {KIND_TITLE[g.kind]}
                </h2>
                <div className="grid gap-6 [grid-template-columns:repeat(auto-fill,minmax(24rem,1fr))]">
                  {g.rows.map((r) => (
                    <Card key={r.familyId} data-testid={`preview-${r.kind}-${r.key}`}>
                      <CardHeader>
                        <CardTitle className="flex flex-wrap items-center gap-2">
                          {r.title}
                          <Badge tone={r.active ? 'success' : 'warning'}>{r.active ? 'Active' : 'Not active — newest version'}</Badge>
                        </CardTitle>
                        <CardDescription>
                          <span className="font-mono">{r.key}</span> · version {r.version}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className={cn('pb-6')}>
                        <DefinitionPreview kind={r.kind} definition={r.definition} bundle={bundle} focus={focus || null} />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </>
  );
}
