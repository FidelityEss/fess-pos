// Definitions studio (docs/04 §7, §9): families, analysis + test cases + changelog + canonical hash on publish, append-only
// activations with audiences (rollback = activate an earlier version), test cases, and four-eyes approvals (D-31).
// Drafts are upserted by the panel directly into pos.definition_drafts (the one client-writable table, docs/05 §0).
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePermission } from '../../../_shared/auth.ts';
import { analyseDefinition, canonicalHash, runTestCases } from '../../../_shared/engine-adapter.ts';
import { PosError } from '../../../_shared/errors.ts';
import { readJson } from '../../../_shared/http.ts';
import type { AppEnv } from '../../../_shared/types.ts';
import { adminRpc, type AdminContext, fourEyesResponse, isoDateTime, jsonObject, reason, snakeKey, uuid, uuidParam } from './_util.ts';
import { changelogOf } from './changelog.ts';

export const definitionRoutes = new Hono<AppEnv>();
const admin = requirePermission(null);

const Kind = z.enum(['form', 'flow', 'job_schema', 'view', 'content', 'app']);

definitionRoutes.post('/definitions/families', admin, async (c) => {
  const body = await readJson(c, z.object({
    kind: Kind,
    key: snakeKey,
    bank_id: uuid.nullable().optional(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional(),
  }));
  return c.json(await adminRpc(c, 'admin_definition_family_create', [[body, 'jsonb']]), 201);
});

definitionRoutes.patch('/definitions/families/:id', admin, async (c) => {
  const body = await readJson(c, z.object({ title: z.string().trim().min(1).max(200), description: z.string().max(2000).nullable() }).partial());
  return c.json(await adminRpc(c, 'admin_definition_family_update', [[uuidParam(c, 'id'), 'uuid'], [body, 'jsonb']]));
});

// ── Analyse / publish ─────────────────────────────────────────────────────────────────────────
interface DefinitionContext {
  family: { id: string; kind: string; key: string; bank_id: string | null };
  draft: { definition: Record<string, unknown>; base_version_id: string | null } | null;
  latest: { id: string; version: number; definition: Record<string, unknown>; definition_hash: string } | null;
  test_cases: Array<{ id: string; name: string; context: Record<string, unknown>; steps: unknown[]; expectations: Record<string, unknown> }>;
  lookup_lists: string[];
  reason_code_categories: string[];
  declarations: string[];
  related: Array<{ kind: 'form' | 'flow' | 'view'; key: string; definition: Record<string, unknown> }>;
}

/** Cross-reference context for the analyser: names and related definitions visible in this family's scope. */
function bundleOf(ctx: DefinitionContext): Parameters<typeof analyseDefinition>[2] {
  const byKind = (kind: 'form' | 'flow' | 'view') =>
    Object.fromEntries(ctx.related.filter((r) => r.kind === kind).map((r) => [r.key, r.definition]));
  const bundle = {
    forms: byKind('form'),
    flows: byKind('flow'),
    views: byKind('view'),
    lookup_lists: ctx.lookup_lists,
    reason_code_categories: ctx.reason_code_categories,
    declarations: ctx.declarations,
  };
  return bundle as unknown as Parameters<typeof analyseDefinition>[2];
}

interface Candidate {
  ok: boolean;
  errors: unknown[];
  warnings: unknown[];
  requires: unknown;
  definition_hash: string;
  spec_version: string | null;
  changelog: ReturnType<typeof changelogOf>['changelog'];
  breaking: boolean;
  tests: { passed: boolean; results: unknown[] };
  previous_version: { id: string; version: number } | null;
  definition: Record<string, unknown>;
}

const AnalyseBody = z.object({ definition: jsonObject.optional(), note: z.string().max(2000).optional() });

async function buildCandidate(c: AdminContext, familyId: string, given: Record<string, unknown> | undefined): Promise<Candidate> {
  const ctx = await adminRpc<DefinitionContext>(c, 'admin_definition_context', [[familyId, 'uuid']]);
  const definition = given ?? ctx.draft?.definition;
  if (!definition) throw new PosError('INVALID_REQUEST', 'no definition given and the family has no saved draft');
  if (definition.kind !== ctx.family.kind) {
    throw new PosError('VALIDATION_FAILED', `definition kind must be ${ctx.family.kind}`, [{ path: '/kind', message: 'kind does not match the family' }]);
  }
  const analysis = analyseDefinition(ctx.family.kind, definition, bundleOf(ctx));

  // Recorded test cases re-run on every publish; any failure blocks (docs/04 §9). They exercise forms.
  let tests: { passed: boolean; results: unknown[] } = { passed: true, results: [] };
  if (analysis.ok && ctx.test_cases.length > 0) {
    if (ctx.family.kind === 'form') {
      const cases = ctx.test_cases.map((t) => ({ name: t.name, context: t.context, steps: t.steps, expect: t.expectations }));
      const run = await runTestCases(definition as Parameters<typeof runTestCases>[0], cases as unknown as Parameters<typeof runTestCases>[1]);
      tests = { passed: run.passed, results: run.results as unknown[] };
    } else {
      tests = { passed: true, results: [{ name: '(skipped)', passed: true, note: `test cases apply to form definitions, not ${ctx.family.kind}` }] };
    }
  }
  const { changelog, breaking } = changelogOf(ctx.family.kind, ctx.latest?.definition ?? null, definition);
  return {
    ok: analysis.ok,
    errors: analysis.errors as unknown[],
    warnings: analysis.warnings as unknown[],
    requires: analysis.requires ?? {},
    definition_hash: await canonicalHash(definition),
    spec_version: typeof definition.spec_version === 'string' ? definition.spec_version : null,
    changelog,
    breaking,
    tests,
    previous_version: ctx.latest ? { id: ctx.latest.id, version: ctx.latest.version } : null,
    definition,
  };
}

definitionRoutes.post('/definitions/families/:id/analyse', admin, async (c) => {
  const body = await readJson(c, AnalyseBody, 4 * 1_048_576);
  const { definition: _d, ...candidate } = await buildCandidate(c, uuidParam(c, 'id'), body.definition);
  return c.json(candidate);
});

definitionRoutes.post('/definitions/families/:id/publish', admin, async (c) => {
  const familyId = uuidParam(c, 'id');
  const body = await readJson(c, AnalyseBody, 4 * 1_048_576);
  const cand = await buildCandidate(c, familyId, body.definition);
  if (!cand.ok || !cand.tests.passed) {
    const { definition: _d, ...details } = cand;
    throw new PosError('VALIDATION_FAILED', cand.ok ? 'test cases failed — publish blocked' : 'static analysis found errors — publish blocked', details);
  }
  if (!cand.spec_version) throw new PosError('VALIDATION_FAILED', 'definition has no spec_version', [{ path: '/spec_version', message: 'required' }]);
  const result = await adminRpc<{ status: string } & Record<string, unknown>>(c, 'admin_definition_publish', [
    [familyId, 'uuid'],
    [{
      definition: cand.definition,
      definition_hash: cand.definition_hash,
      spec_version: cand.spec_version,
      requires: cand.requires,
      changelog: { ...cand.changelog, ...(body.note ? { note: body.note } : {}) },
      breaking: cand.breaking,
      analysis: { ok: cand.ok, errors: cand.errors, warnings: cand.warnings },
      test_run: cand.tests,
      base_version_id: cand.previous_version?.id ?? null,
      note: body.note ?? null,
    }, 'jsonb'],
  ]);
  return fourEyesResponse(c, result);
});

// ── Activation (append-only; rollback = activate an earlier version) ─────────────────────────
const Audience = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('agents'), user_ids: z.array(uuid).min(1).max(1000) }),
  z.object({ type: z.literal('percent'), percent: z.number().int().min(1).max(100) }),
  z.object({ type: z.literal('attribute'), key: z.string().regex(/^[a-z][a-z0-9_]*$/), values: z.array(z.string().min(1)).min(1).max(200) }),
]);
const Activate = z.object({
  version_id: uuid,
  audience: Audience,
  policy: z.object({ incompatible: z.enum(['block', 'fallback_version', 'field_fallback']) }).optional(),
  effective_from: isoDateTime.optional(),
  effective_to: isoDateTime.nullable().optional(),
  reason,
});

definitionRoutes.post('/definitions/families/:id/activations', admin, async (c) => {
  const body = await readJson(c, Activate);
  const result = await adminRpc<{ status: string } & Record<string, unknown>>(c, 'admin_definition_activate', [
    [uuidParam(c, 'id'), 'uuid'],
    [body.version_id, 'uuid'],
    [body.audience, 'jsonb'],
    [body.policy ?? null, 'jsonb'],
    [body.effective_from ?? null, 'timestamptz'],
    [body.effective_to ?? null, 'timestamptz'],
    [body.reason, 'text'],
  ]);
  return fourEyesResponse(c, result);
});

// ── Test cases ────────────────────────────────────────────────────────────────────────────────
const TestCaseFields = z.object({
  name: z.string().trim().min(1).max(200),
  context: jsonObject,
  steps: z.array(jsonObject).max(200),
  expectations: jsonObject,
});
definitionRoutes.post('/definitions/families/:id/test-cases', admin, async (c) => {
  const body = await readJson(c, TestCaseFields.partial().extend({ name: TestCaseFields.shape.name }), 1_048_576);
  return c.json(await adminRpc(c, 'admin_test_case_create', [[uuidParam(c, 'id'), 'uuid'], [body, 'jsonb']]), 201);
});
definitionRoutes.patch('/definitions/test-cases/:id', admin, async (c) => {
  const body = await readJson(c, TestCaseFields.partial(), 1_048_576);
  return c.json(await adminRpc(c, 'admin_test_case_update', [[uuidParam(c, 'id'), 'uuid'], [body, 'jsonb']]));
});
definitionRoutes.post('/definitions/test-cases/:id/archive', admin, async (c) => {
  return c.json(await adminRpc(c, 'admin_test_case_archive', [[uuidParam(c, 'id'), 'uuid']]));
});

// ── Four-eyes decisions ──────────────────────────────────────────────────────────────────────
definitionRoutes.post('/approvals/:id/decide', admin, async (c) => {
  const body = await readJson(c, z.object({ decision: z.enum(['approved', 'rejected', 'withdrawn']), note: z.string().max(2000).optional() }));
  return c.json(await adminRpc(c, 'admin_approval_decide', [[uuidParam(c, 'id'), 'uuid'], [body.decision, 'text'], [body.note ?? null, 'text']]));
});
