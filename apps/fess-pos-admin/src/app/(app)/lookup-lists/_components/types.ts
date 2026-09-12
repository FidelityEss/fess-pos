import type { LookupItem, LookupList, LookupListVersion } from '@/lib/types';

/** A lookup list with its latest version embedded (PostgREST: order version desc, limit 1). */
export type ListRow = LookupList & { lookup_list_versions: Pick<LookupListVersion, 'id' | 'version' | 'items' | 'published_at'>[] | null };

export function latestVersion(list: ListRow): Pick<LookupListVersion, 'id' | 'version' | 'items' | 'published_at'> | null {
  return list.lookup_list_versions?.[0] ?? null;
}

export function latestItems(list: ListRow): LookupItem[] {
  const items = latestVersion(list)?.items;
  return Array.isArray(items) ? items : [];
}
