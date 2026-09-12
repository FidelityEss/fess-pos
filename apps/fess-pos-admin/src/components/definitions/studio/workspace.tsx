'use client';

// The studio workspace: the structured editor for the family's kind on the left and the live phone preview on the right
// (sticky on wide screens, collapsible on narrow ones). The preview follows the selection. In Advanced view an
// "Edit as JSON" tab edits the same document. Also used read-only to show a published version as an outline.
import { Braces, LayoutList, Smartphone } from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { DefinitionPreview, type PreviewKind } from '@/components/preview/definition-preview';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsAdvanced } from '@/lib/preferences';
import type { DefinitionFamily } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AppEditor } from './app-editor';
import { useStudioRefs, withDraft } from './bundle';
import { ContentEditor } from './content-editor';
import { asObj, asStr, getIn, type Obj, parsePathKey } from './doc';
import { FlowEditor } from './flow-editor';
import { FormEditor } from './form-editor';
import { JobSchemaEditor } from './job-schema-editor';
import { type EditorProps, StudioProvider, type Update } from './shared';
import { ViewEditor } from './view-editor';

/** Preview focus for a selection path: a section / field key, step id, page id, content key or item id. */
export function focusFor(kind: string, doc: unknown, selected: string | null): string | null {
  if (!selected) return null;
  const segs = parsePathKey(selected);
  switch (kind) {
    case 'form': {
      let focus: string | null = null;
      for (let n = 2; n <= segs.length; n += 2) {
        const k = asStr(asObj(getIn(doc, segs.slice(0, n))).key);
        if (k) focus = k;
      }
      return focus;
    }
    case 'job_schema':
      return asStr(asObj(getIn(doc, segs.slice(0, 2))).key) || null;
    case 'flow': {
      const s = asObj(getIn(doc, segs.slice(0, 2)));
      return asStr(s.id) || null;
    }
    case 'view': {
      const it = asObj(getIn(doc, segs.slice(0, 2)));
      return asStr(it.id) || null;
    }
    case 'app':
    case 'content':
      return segs[0] === 'pages' || segs[0] === 'strings' ? String(segs.slice(1).join('/')) : null;
    default:
      return null;
  }
}

function EditorFor({ kind, ...props }: EditorProps & { kind: string }) {
  switch (kind) {
    case 'form':
      return <FormEditor {...props} />;
    case 'flow':
      return <FlowEditor {...props} />;
    case 'job_schema':
      return <JobSchemaEditor {...props} />;
    case 'view':
      return <ViewEditor {...props} />;
    case 'content':
      return <ContentEditor {...props} />;
    case 'app':
      return <AppEditor {...props} />;
    default:
      return <p className="text-sm text-muted-foreground">There is no structured editor for “{kind}” yet.</p>;
  }
}

const noopUpdate: Update = () => undefined;

export function DefinitionWorkspace({
  family,
  doc,
  previewDoc,
  update,
  readOnly = false,
  selected,
  onSelect,
  jsonEditor,
  invalidJsonMessage,
  className,
}: {
  family: Pick<DefinitionFamily, 'kind' | 'key' | 'bank_id' | 'scope'>;
  /** The document being edited; null when the JSON text does not parse (edit it in the JSON tab). */
  doc: Obj | null;
  /** What the phone shows (the last document that parsed). */
  previewDoc: Obj | null;
  update?: Update;
  readOnly?: boolean;
  selected: string | null;
  onSelect: (path: string | null) => void;
  /** The raw JSON editor, offered as a tab in Advanced view. */
  jsonEditor?: ReactNode;
  invalidJsonMessage?: string;
  className?: string;
}) {
  const advanced = useIsAdvanced();
  const refs = useStudioRefs(family);
  const [fresh] = useState(() => new Set<string>());
  const [tab, setTab] = useState<'structured' | 'json'>('structured');
  const [previewOpen, setPreviewOpen] = useState(false);
  const showJson = advanced && !!jsonEditor && tab === 'json';
  const ro = readOnly || !update;
  const ctx = useMemo(() => ({ readOnly: ro, refs, bankId: family.scope === 'global' ? null : family.bank_id, fresh }), [ro, refs, family.scope, family.bank_id, fresh]);
  const bundle = useMemo(() => withDraft(refs.bundle, family.kind, family.key, previewDoc), [refs.bundle, family.kind, family.key, previewDoc]);
  const focus = useMemo(() => focusFor(family.kind, previewDoc, selected), [family.kind, previewDoc, selected]);
  const select = useCallback((p: string | null) => onSelect(p), [onSelect]);

  const tabBtn = (value: 'structured' | 'json', label: string, Icon: typeof Braces) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => setTab(value)}
      className={cn('inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm', tab === value ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
    >
      <Icon className="size-4" /> {label}
    </button>
  );

  return (
    <StudioProvider value={ctx}>
      <div className={cn('grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]', className)}>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {advanced && jsonEditor ? (
              <div className="inline-flex rounded-md border bg-muted p-0.5" role="tablist" aria-label="Editor">
                {tabBtn('structured', 'Editor', LayoutList)}
                {tabBtn('json', 'Edit as JSON', Braces)}
              </div>
            ) : (
              <span />
            )}
            <Button type="button" size="sm" variant="outline" className="xl:hidden" onClick={() => setPreviewOpen((o) => !o)} aria-expanded={previewOpen}>
              <Smartphone /> {previewOpen ? 'Hide phone preview' : 'Show phone preview'}
            </Button>
          </div>
          {previewOpen ? (
            <div className="xl:hidden">
              <DefinitionPreview kind={family.kind as PreviewKind} definition={previewDoc} bundle={bundle} focus={focus} />
            </div>
          ) : null}
          {showJson ? (
            jsonEditor
          ) : doc ? (
            refs.loading && family.kind !== 'content' ? (
              <Skeleton className="h-96 w-full" />
            ) : (
              <EditorFor kind={family.kind} doc={doc} update={update ?? noopUpdate} selected={selected} onSelect={select} />
            )
          ) : (
            <Alert variant="warning">
              <AlertTitle>The document can&apos;t be shown as an outline</AlertTitle>
              <AlertDescription>
                {invalidJsonMessage ?? 'Its JSON has an error.'} {advanced ? 'Fix it in the “Edit as JSON” tab.' : 'Switch to Advanced view (top right) to fix it in the JSON editor, or reset the draft.'}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <aside className="hidden xl:block">
          <div className="sticky top-20 space-y-2">
            <p className="text-sm font-medium text-muted-foreground">On the phone</p>
            <DefinitionPreview kind={family.kind as PreviewKind} definition={previewDoc} bundle={bundle} focus={focus} />
          </div>
        </aside>
      </div>
    </StudioProvider>
  );
}
