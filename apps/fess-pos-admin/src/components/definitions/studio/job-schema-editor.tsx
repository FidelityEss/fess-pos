'use client';

// Job schema editor: the extra job details a bank captures (docs/04 §3.3) as an attribute list — key, label, type,
// options, format pattern, required — reusing the question rows and settings of the form editor.
import { Card, CardContent } from '@/components/ui/card';
import type { ComponentSpec } from '@/lib/engine';
import { DocumentHeader } from './document-header';
import { FieldList, useListCtx } from './form-editor';
import { type EditorProps, Hint } from './shared';

const allowJobSchema = (spec: ComponentSpec) => spec.jobSchema;

export function JobSchemaEditor(props: EditorProps) {
  const { doc, update, selected, onSelect } = props;
  const ctx = useListCtx(doc, 'job_schema', allowJobSchema);
  return (
    <div className="grid gap-4">
      <DocumentHeader doc={doc} update={update} />
      <Card>
        <CardContent className="grid gap-3 p-4">
          <div>
            <h3 className="text-base font-semibold">Job details</h3>
            <Hint>
              Extra details recorded on each job — shown in the job form and CSV import, and available to screens and rules (for example the risk tier can raise
              the photo minimum).
            </Hint>
          </div>
          <FieldList arrayPath={['attributes']} doc={doc} update={update} selected={selected} onSelect={onSelect} ctx={ctx} addLabel="Add a job detail" />
        </CardContent>
      </Card>
    </div>
  );
}
