'use client';

// Job schema preview (T3-23): the job detail screen with a "Bank details" section — each attribute with the sample
// job's value (docs/04 §3.3: attributes are available to views as job.attributes.*). The section sits after the job's
// key facts (before the map) so it is visible without scrolling. Flat labelled rows between hairlines (D-97).
import type { FieldDef, ViewItemDef } from '@/lib/engine';
import { cn } from '@/lib/utils';
import { lenientParse } from './lenient-parse';
import { PhoneSection } from './phone-frame';
import { PAGE_X, PP_TINT_BG, typeStyle } from './phone-style';
import { PreviewNotice } from './phone-widgets';
import { templateText, usePreviewEnv } from './preview-context';
import { formatValue, humanise } from './preview-format';
import { ViewItems } from './view-renderer';

const FALLBACK_HEADER: ViewItemDef[] = [
  { type: 'title', bind: 'job.merchant_name' },
  { type: 'status_chip', bind: 'job.status' },
  { type: 'field_value', label: 'Reference', bind: 'job.reference' },
];

function attributeValue(attr: FieldDef, value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not set on this job';
  if (attr.options && typeof value === 'string') return attr.options.find((o) => o.value === value)?.label ?? value;
  if (attr.options && Array.isArray(value)) return value.map((v) => attr.options?.find((o) => o.value === v)?.label ?? String(v)).join(', ');
  return formatValue(value);
}

export function JobSchemaScreen({ attributes }: { attributes: readonly FieldDef[] }) {
  const env = usePreviewEnv();
  const values = env.context.job.attributes;
  const doc = env.bundle.views?.job_detail;
  const items = doc ? ((lenientParse('view', doc).definition?.items as ViewItemDef[] | undefined) ?? []) : [];
  // Key facts first, then Bank details, then the rest of the configured job detail view (map, contact, notes…).
  let split = items.findIndex((i) => i.type === 'map_preview' || i.type === 'divider' || i.type === 'markdown');
  if (split < 0) split = items.length;
  const before = items.length ? items.slice(0, split) : FALLBACK_HEADER;
  const after = items.slice(split);
  return (
    <div className="space-y-4 pb-4">
      <div className={cn(PAGE_X, 'pt-4')}>
        <ViewItems items={before} data={env.data} />
      </div>
      <PhoneSection title="Bank details" className="pt-0">
        {attributes.length === 0 ? (
          <PreviewNotice>No job information yet.</PreviewNotice>
        ) : (
          <div className="divide-y divide-[color:var(--ph-divider)] border-y border-[color:var(--ph-divider)]" data-preview-anchor="bank_details">
            {attributes.map((a) => {
              const v = values[a.key];
              const focused = env.focus === a.key;
              const unset = v === undefined || v === null;
              return (
                <div key={a.key} data-preview-anchor={a.key} className={cn('py-2.5', focused && cn(PP_TINT_BG, '-mx-2 px-2 ring-2 ring-inset ring-[var(--pp)]'))}>
                  <div className="text-[color:var(--ph-body)]" style={typeStyle('caption')}>
                    {typeof a.label === 'string' ? templateText(a.label, env.data) : humanise(a.key)}
                  </div>
                  <div className={cn('leading-snug text-[color:var(--ph-body)]', unset && 'italic')} style={typeStyle(unset ? 'bodyRegular' : 'body')}>
                    {attributeValue(a, v)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PhoneSection>
      {after.length ? (
        <div className={PAGE_X}>
          <ViewItems items={after} data={env.data} />
        </div>
      ) : null}
    </div>
  );
}
