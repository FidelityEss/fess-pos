// "Preview on a phone" (T3-12, D-101, docs/04 §10): an admin makes a short-lived link that opens their draft in the app on
// a phone. The token is random and shown once, in the links; only its SHA-256 fingerprint is stored, with the preview
// request ({kind, definition, bundle, context, theme}) exactly as the admin panel drew it. The phone fetches it with
// GET /v1/preview/:token (../preview.ts).
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePermission } from '../../../_shared/auth.ts';
import { randomToken, sha256Hex } from '../../../_shared/crypto.ts';
import { canonicalHash } from '../../../_shared/engine-adapter.ts';
import { readJson } from '../../../_shared/http.ts';
import type { AppEnv } from '../../../_shared/types.ts';
import { adminRpc, jsonObject, uuid } from './_util.ts';

export const previewLinkRoutes = new Hono<AppEnv>();
const admin = requirePermission(null);

const Kind = z.enum(['form', 'flow', 'view', 'content', 'job_schema', 'app']);

/** The largest preview a phone is sent (the database checks it again). */
const MAX_BYTES = 2_000_000;

const Body = z.object({
  kind: Kind,
  definition: jsonObject,
  bundle: jsonObject.optional(),
  context: jsonObject.optional(),
  theme: z.object({
    primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, '#RRGGBB').nullable().optional(),
    font_family: z.string().max(100).nullable().optional(),
  }).optional(),
  /** The draft's family, when it has one: its bank decides who may make the link. */
  family_id: uuid.nullable().optional(),
  /** A bank's own preview without a family (a bank's App settings). */
  bank_id: uuid.nullable().optional(),
});

interface Created {
  id: string;
  kind: string;
  family_id: string | null;
  bank_id: string | null;
  expires_at: string;
  link_templates: Record<string, unknown>;
}

previewLinkRoutes.post('/preview-links', admin, async (c) => {
  const body = await readJson(c, Body, MAX_BYTES + 64 * 1024);
  const request = {
    kind: body.kind,
    definition: body.definition,
    bundle: body.bundle ?? {},
    context: body.context ?? {},
    ...(body.theme ? { theme: body.theme } : {}),
  };
  // base64url: fits the module's link pattern (/pos/preview/<token>).
  const token = randomToken(32);
  const created = await adminRpc<Created>(c, 'admin_preview_link_create', [
    [{ kind: body.kind, request, family_id: body.family_id ?? null, bank_id: body.bank_id ?? null }, 'jsonb'],
    [await sha256Hex(token), 'text'],
    [await canonicalHash(request), 'text'],
  ]);
  const links = Object.fromEntries(
    Object.entries(created.link_templates ?? {})
      .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].includes('{token}'))
      .map(([platform, template]) => [platform, template.replace('{token}', token)]),
  );
  return c.json({
    id: created.id,
    kind: created.kind,
    token,
    path: `/pos/preview/${token}`,
    links,
    expires_at: created.expires_at,
  }, 201);
});
