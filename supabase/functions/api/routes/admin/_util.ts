// Shared plumbing for /v1/admin/* routes: the acting staff member, one pos_rpc.admin_* call per write (docs/03 §4
// principle 3), path-parameter validation and the four-eyes response convention (201 done / 202 approval required).
import type { Context } from 'hono';
import { z } from 'zod';
import { type Arg, asService, rpc } from '../../../_shared/db.ts';
import { PosError } from '../../../_shared/errors.ts';
import { rid } from '../../../_shared/http.ts';
import type { AppEnv } from '../../../_shared/types.ts';

export type AdminContext = Context<AppEnv>;

export function staffActor(c: AdminContext) {
  const staff = c.get('staff');
  return { id: staff.userId, role: 'pos_admin', requestId: rid(c) };
}

/** Call pos_rpc.<fn>(p_actor, …args) in one service transaction with the request context set. */
export async function adminRpc<T>(c: AdminContext, fn: `admin_${string}`, args: Arg[] = []): Promise<T> {
  const staff = c.get('staff');
  return await asService(staffActor(c), (tx) => rpc<T>(tx, fn, [[staff.userId, 'uuid'], ...args]));
}

/** A non-admin pos_rpc function (resolve_config, queue_depths) called on behalf of the staff member. */
export async function serviceRpc<T>(c: AdminContext, fn: string, args: Arg[] = []): Promise<T> {
  return await asService(staffActor(c), (tx) => rpc<T>(tx, fn, args));
}

const Uuid = z.string().uuid();

export function uuidParam(c: AdminContext, name: string): string {
  const v = c.req.param(name);
  const parsed = Uuid.safeParse(v);
  if (!parsed.success) throw new PosError('INVALID_REQUEST', `${name} must be a uuid`, [{ path: name, message: 'uuid expected' }]);
  return parsed.data;
}

export function uuidQuery(c: AdminContext, name: string): string | null {
  const v = c.req.query(name);
  if (v === undefined || v === '') return null;
  const parsed = Uuid.safeParse(v);
  if (!parsed.success) throw new PosError('INVALID_REQUEST', `${name} must be a uuid`, [{ path: name, message: 'uuid expected' }]);
  return parsed.data;
}

/** Four-eyes aware response: 202 when the database created an approval request instead of applying the change. */
export function fourEyesResponse(c: AdminContext, result: { status?: string } & Record<string, unknown>) {
  return c.json(result, result.status === 'approval_required' ? 202 : 201);
}

/** Bank scope as seen by the API (the database re-checks): null bankIds = all banks. */
export function assertBankScope(c: AdminContext, bankId: string | null): void {
  const staff = c.get('staff');
  if (bankId && staff.bankIds && !staff.bankIds.includes(bankId)) {
    throw new PosError('FORBIDDEN', 'bank outside your scope', { bank_id: bankId });
  }
}

// ── Common Zod pieces ─────────────────────────────────────────────────────────────────────────
export const uuid = Uuid;
export const reason = z.string().trim().min(1).max(2000);
export const note = z.string().trim().max(2000).optional();
export const isoDateTime = z.string().datetime({ offset: true });
export const jsonObject = z.record(z.unknown());
export const snakeKey = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, 'snake_case, 2–64 characters');
export const reasonCode = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, 'reason code');

/** Zod issues → [{path, message}] like readJson does. */
export function issues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}
