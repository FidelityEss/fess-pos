// Where a piece of the set-up stands, in plain words (docs/17 §4.6): "Live for Bank ABC", "Published, not live yet",
// "Draft", "Not set up yet". Version numbers are a hint, never the headline.
import type { StatusTone } from '@/lib/status';
import type { DefinitionActivation } from '@/lib/types';
import { liveActivations, liveForLabel } from './definitions-data';

export interface PieceStatus {
  label: string;
  tone: StatusTone;
  /** Secondary detail, such as "Version 3". */
  hint?: string;
}

/** After publishing, the studio saves the draft again with its new starting point; edits within this window aren't "new" changes. */
const DRAFT_GRACE_MS = 60_000;

export interface PieceStatusInput {
  /** This piece's published versions. */
  versions: readonly { id: string; version: number; published_at: string }[];
  /** This piece's activations (any order). */
  activations: readonly DefinitionActivation[];
  /** When the saved draft was last changed, if there is one. */
  draftUpdatedAt?: string | null;
  /** Whether the draft's content differs from the newest version, when known exactly (overrides the time-based guess). */
  draftChanged?: boolean;
  now: number;
  /** The bank the piece belongs to; null when it's shared by all banks. */
  bankName: string | null;
}

/** Key-order-insensitive fingerprint of a JSON value, to tell whether two documents say the same thing. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export function pieceStatuses({ versions, activations, draftUpdatedAt, draftChanged, now, bankName }: PieceStatusInput): PieceStatus[] {
  const out: PieceStatus[] = [];
  const byId = new Map(versions.map((v) => [v.id, v]));
  const live = liveActivations([...activations], now);
  for (const a of live) {
    const v = byId.get(a.version_id);
    out.push({ label: liveForLabel(a.audience, bankName), tone: a.audience.type === 'all' ? 'success' : 'progress', hint: v ? `Version ${v.version}` : undefined });
  }
  let newest: (typeof versions)[number] | undefined;
  for (const v of versions) if (!newest || v.version > newest.version) newest = v;
  const newestLive = Math.max(0, ...live.map((a) => byId.get(a.version_id)?.version ?? 0));
  if (newest && newest.version > newestLive) {
    out.push({ label: live.length ? 'Newer version not live yet' : 'Published, not live yet', tone: 'info', hint: `Version ${newest.version}` });
  }
  const draftIsNewer =
    draftChanged ?? (!!draftUpdatedAt && (!newest || Date.parse(draftUpdatedAt) - Date.parse(newest.published_at) > DRAFT_GRACE_MS));
  if (draftIsNewer) out.push({ label: 'Draft', tone: 'neutral', hint: newest ? 'Changes not published yet' : 'Not published yet' });
  if (out.length === 0) out.push({ label: 'Not set up yet', tone: 'muted' });
  return out;
}
