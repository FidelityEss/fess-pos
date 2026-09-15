'use client';

import { Suspense, use } from 'react';
import { FamilyStudio } from '@/components/definitions/family-studio';
import { PageSpinner } from '@/components/ui/spinner';

// The tab is kept in `?tab=` (so "Make it live" after publishing can open the right tab) — useSearchParams → Suspense.
export default function DefinitionFamilyPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = use(params);
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <FamilyStudio familyId={familyId} />
    </Suspense>
  );
}
