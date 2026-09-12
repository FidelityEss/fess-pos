// Database access for the POS API (D-32). One direct Postgres connection pool per isolate.
//   asService(actor, fn) — transaction as service_role, request context set; call exactly one pos_rpc function.
//   asAgent(claims, fn)  — transaction as `authenticated` with the verified POS claims, so RLS applies to reads.
// Multi-step writes never use PostgREST chains (docs/03 §4 principle 3).
import postgres from 'postgres';
import { env } from './env.ts';
import { fromDbError, PosError } from './errors.ts';

export type Tx = postgres.TransactionSql;

let pool: postgres.Sql | null = null;

export function db(): postgres.Sql {
  if (!pool) {
    if (!env.dbUrl) throw new PosError('UNAVAILABLE', 'database URL not configured');
    pool = postgres(env.dbUrl, {
      prepare: false,
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      connection: { application_name: 'fess-pos-api' },
      onnotice: () => {},
    });
  }
  return pool;
}

export interface Actor {
  id: string | null;
  role: string;
  requestId: string;
}

export async function asService<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return (await db().begin(async (tx) => {
      await tx`set local role service_role`;
      await tx`select pos_rpc.set_context(${actor.id}::uuid, ${actor.role}, ${actor.requestId})`;
      return await fn(tx);
    })) as T;
  } catch (e) {
    throw fromDbError(e);
  }
}

export async function asAgent<T>(claims: Record<string, unknown>, requestId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return (await db().begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true), set_config('pos.request_id', ${requestId}, true)`;
      return await fn(tx);
    })) as T;
  } catch (e) {
    throw fromDbError(e);
  }
}

/** Switch an open service transaction to the agent's claims (same transaction, RLS applies from here on). */
export async function becomeAgent(tx: Tx, claims: Record<string, unknown>): Promise<void> {
  await tx`set local role authenticated`;
  await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
}

export type PgType = 'text' | 'uuid' | 'jsonb' | 'integer' | 'bigint' | 'boolean' | 'timestamptz' | 'uuid[]' | 'text[]' | 'numeric' | 'pos.reason_category' | 'pos.review_decision' | 'pos.config_layer' | 'pos.definition_kind' | 'pos.scope_kind' | 'pos.pos_role' | 'pos.contact_channel' | 'pos.contact_outcome' | 'pos.export_type' | 'pos.issuer_type' | 'pos.location_source' | 'pos.release_status';
export type Arg = [value: unknown, type: PgType];

const FN_NAME = /^[a-z_][a-z0-9_]*$/;

// JSON goes over the wire as text and is cast server-side ($n::text::jsonb). Letting postgres.js see a jsonb
// parameter makes it JSON-encode the value itself, which double-encodes an already-serialised string.
function toParam(value: unknown, type: PgType): unknown {
  if (value === undefined || value === null) return null;
  if (type === 'jsonb') return JSON.stringify(value);
  return value;
}

function placeholder(type: PgType, i: number): string {
  return type === 'jsonb' ? `$${i + 1}::text::jsonb` : `$${i + 1}::${type}`;
}

/** Call pos_rpc.<fn>(…) with explicitly typed arguments; returns the single result value. */
export async function rpc<T = unknown>(tx: Tx, fn: string, args: Arg[] = []): Promise<T> {
  if (!FN_NAME.test(fn)) throw new PosError('INTERNAL', `bad rpc name ${fn}`);
  const placeholders = args.map(([, t], i) => placeholder(t, i)).join(', ');
  const rows = await tx.unsafe(`select pos_rpc.${fn}(${placeholders}) as r`, args.map(([v, t]) => toParam(v, t)) as never[]);
  return (rows[0]?.r ?? null) as T;
}

/** Set-returning pos_rpc function → rows. */
export async function rpcRows<T = Record<string, unknown>>(tx: Tx, fn: string, args: Arg[] = []): Promise<T[]> {
  if (!FN_NAME.test(fn)) throw new PosError('INTERNAL', `bad rpc name ${fn}`);
  const placeholders = args.map(([, t], i) => placeholder(t, i)).join(', ');
  const rows = await tx.unsafe(`select * from pos_rpc.${fn}(${placeholders})`, args.map(([v, t]) => toParam(v, t)) as never[]);
  return rows as unknown as T[];
}
