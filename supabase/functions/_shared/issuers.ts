// Host identity verification — trusted issuers are configuration, not code (docs/07 §2, D-05).
//   dev_stub       stand-in issuer for dev/staging: HS256 JWT signed with the Vault key pos_dev_issuer_secret.
//                  Refused when POS_ENV=production.
//   jwks           JWT verified against the issuer's published keys (e.g. Firebase) — never sufficient alone for FESS.
//   introspection  server-to-server call described entirely by trusted_issuers.request_template (e.g. FESS
//                  getEmployeeDetails). The credential is a function secret named by trusted_issuers.secret_name.
// Agents never call FESS endpoints: the FESS issuers are seeded inactive and configured by humans (instructions §10).
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { env } from './env.ts';
import { PosError } from './errors.ts';
import { secret, secretKeyBytes } from './secrets.ts';

export interface IssuerRow {
  key: string;
  type: 'jwks' | 'introspection' | 'dev_stub';
  issuer: string | null;
  audience: string | null;
  jwks_url: string | null;
  introspection_url: string | null;
  request_template: Record<string, unknown>;
  subject_claim: string | null;
  employee_number_source: Record<string, unknown>;
  secret_name: string | null;
  active: boolean;
  primary_issuer: boolean;
}

export interface VerifiedIdentity {
  subject: string;
  employeeNumber: string | null;
  firstName?: string;
  lastName?: string;
}

export function readPath(obj: unknown, path: string | undefined | null): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number') return String(v);
  return null;
}

const DEV_ISSUER = 'pos-dev-issuer';
const DEV_AUDIENCE = 'fess-pos';
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function substitute(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') return value.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
  if (Array.isArray(value)) return value.map((v) => substitute(v, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, substitute(v, vars)]));
  }
  return value;
}

export async function verifyHostToken(issuer: IssuerRow, token: string): Promise<VerifiedIdentity> {
  const source = issuer.employee_number_source ?? {};
  switch (issuer.type) {
    case 'dev_stub': {
      if (env.posEnv === 'production') throw new PosError('ISSUER_NOT_ACCEPTED', 'the stand-in issuer is disabled in production');
      try {
        const { payload } = await jwtVerify(token, secretKeyBytes(await secret('pos_dev_issuer_secret')), {
          issuer: issuer.issuer ?? DEV_ISSUER,
          audience: issuer.audience ?? DEV_AUDIENCE,
          algorithms: ['HS256'],
        });
        const subject = str(payload.sub);
        if (!subject) throw new Error('no subject');
        return {
          subject,
          employeeNumber: str(readPath(payload, String(source.claim ?? 'employee_number'))),
          firstName: str(payload.first_name) ?? undefined,
          lastName: str(payload.last_name) ?? undefined,
        };
      } catch (e) {
        if (e instanceof PosError) throw e;
        throw new PosError('INVALID_HOST_TOKEN', 'host token rejected by the issuer');
      }
    }
    case 'jwks': {
      if (!issuer.jwks_url) throw new PosError('ISSUER_NOT_ACCEPTED', 'issuer has no JWKS URL');
      let jwks = jwksCache.get(issuer.jwks_url);
      if (!jwks) {
        jwks = createRemoteJWKSet(new URL(issuer.jwks_url));
        jwksCache.set(issuer.jwks_url, jwks);
      }
      try {
        const { payload } = await jwtVerify(token, jwks, { issuer: issuer.issuer ?? undefined, audience: issuer.audience ?? undefined });
        const subject = str(readPath(payload, issuer.subject_claim ?? 'sub'));
        if (!subject) throw new Error('no subject');
        return {
          subject,
          employeeNumber: source.type === 'claim' ? str(readPath(payload, String(source.path ?? ''))) : null,
        };
      } catch {
        throw new PosError('INVALID_HOST_TOKEN', 'host token rejected by the issuer');
      }
    }
    case 'introspection': {
      const t = issuer.request_template ?? {};
      if (!issuer.introspection_url) throw new PosError('ISSUER_NOT_ACCEPTED', 'issuer has no introspection URL');
      const credential = issuer.secret_name ? Deno.env.get(issuer.secret_name) ?? '' : '';
      const vars = { token, secret: credential };
      const headers = substitute(t.headers ?? { 'content-type': 'application/json' }, vars) as Record<string, string>;
      const body = t.body === undefined ? undefined : JSON.stringify(substitute(t.body, vars));
      let res: Response;
      try {
        res = await fetch(issuer.introspection_url, {
          method: String(t.method ?? 'POST'),
          headers,
          body,
          signal: AbortSignal.timeout(Number(t.timeout_ms ?? 8000)),
        });
      } catch {
        throw new PosError('UNAVAILABLE', 'identity issuer unreachable');
      }
      if (res.status >= 500) throw new PosError('UNAVAILABLE', 'identity issuer error');
      if (!res.ok) throw new PosError('INVALID_HOST_TOKEN', 'host token rejected by the issuer');
      const json: unknown = await res.json().catch(() => null);
      if (t.success_path && !readPath(json, String(t.success_path))) throw new PosError('INVALID_HOST_TOKEN', 'host token rejected by the issuer');
      const employeeNumber = str(readPath(json, String(source.path ?? '')));
      const subject = str(readPath(json, String(t.subject_path ?? source.path ?? ''))) ?? employeeNumber;
      if (!subject) throw new PosError('INVALID_HOST_TOKEN', 'issuer answer has no subject');
      const names = (t.names ?? {}) as Record<string, string>;
      return {
        subject,
        employeeNumber,
        firstName: str(readPath(json, names.first_name)) ?? undefined,
        lastName: str(readPath(json, names.last_name)) ?? undefined,
      };
    }
  }
}

/** Stand-in identity provider (dev/staging only): mint a host token the way a host app would obtain one. */
export async function mintDevHostToken(
  issuer: IssuerRow,
  user: { employee_number: string; first_name: string; last_name: string },
  ttlSeconds = 3600,
): Promise<string> {
  if (env.posEnv === 'production') throw new PosError('FORBIDDEN', 'the stand-in issuer is disabled in production');
  if (issuer.type !== 'dev_stub') throw new PosError('INVALID_REQUEST', 'not a stand-in issuer');
  return await new SignJWT({ employee_number: user.employee_number, first_name: user.first_name, last_name: user.last_name })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(issuer.issuer ?? DEV_ISSUER)
    .setAudience(issuer.audience ?? DEV_AUDIENCE)
    .setSubject(`dev:${user.employee_number}`)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secretKeyBytes(await secret('pos_dev_issuer_secret')));
}
