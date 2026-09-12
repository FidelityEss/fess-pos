'use client';

import { use } from 'react';
import { FamilyStudio } from '@/components/definitions/family-studio';

export default function DefinitionFamilyPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = use(params);
  return <FamilyStudio familyId={familyId} />;
}
