// Registration links for admins and bank viewers (T2-37, D-96, docs/07 §2, docs/17 §4.9). Replaces the temporary
// password + authenticator-app set-up. Supabase Auth makes the single-use invite token and sends the email; the POS
// database records the link (pos.admin_invitations) and re-checks actor and bank scope in every pos_rpc.admin_invitation_*.
//
//   POST /invitations                 add someone (or pick someone already on People) and send their link
//   POST /invitations/:id/resend      a new link (the earlier one stops working), emailed again when possible
//   POST /invitations/:id/link        Copy link: the link that is waiting, the same one as in the email
//   POST /invitations/:id/cancel      the link stops working and its unused sign-in is removed
//   POST /invitations/accept          the registration page, once the new person has chosen a password
//   POST /users/:id/sign-in-link      a new sign-in link for someone who has signed up and forgotten their password:
//                                     Supabase Auth's password-reset token, emailed when possible and returned for Copy
//                                     link; it opens /register?type=recovery (pos_rpc.admin_sign_in_link_*, migration
//                                     20260915140000). "Forgot your password?" on /sign-in asks Supabase Auth directly.
//
// A link is a credential until it is used: responses are no-store, and it is never logged.
import { Hono } from 'hono';
import { z } from 'zod';
import { requirePermission } from '../../../_shared/auth.ts';
import { env } from '../../../_shared/env.ts';
import { PosError } from '../../../_shared/errors.ts';
import { readJson } from '../../../_shared/http.ts';
import { log } from '../../../_shared/log.ts';
import { service } from '../../../_shared/storage.ts';
import type { AppEnv } from '../../../_shared/types.ts';
import { type AdminContext, adminRpc, jsonObject, uuid, uuidParam } from './_util.ts';

export const invitationRoutes = new Hono<AppEnv>();
const admin = requirePermission(null);

const Email = z.string().trim().toLowerCase().email().max(320);
const Person = z.object({
  employee_number: z.string().trim().regex(/^[A-Za-z0-9-]{1,32}$/).optional(),
  first_name: z.string().trim().min(1).max(120),
  last_name: z.string().trim().min(1).max(120),
  phone: z.string().max(40).nullable().optional(),
  role: z.enum(['pos_admin', 'pos_bank_reader']),
  permissions: z.array(z.enum(['review_inspections', 'approve_definitions', 'schedule_jobs'])).max(3).default([]),
  bank_ids: z.array(uuid).max(100).nullable(),
  attributes: jsonObject.optional(),
});
const InvitationCreate = z.union([
  z.object({ email: Email, user_id: uuid }).strict(),
  z.object({ email: Email, person: Person }).strict(),
]);

type EmailError = 'not_allowed' | 'rate_limited' | 'failed';
interface Issued {
  authUid: string;
  /** From generateLink only (no email); the invite path reads the token from the database instead. */
  tokenHash: string | null;
  emailSent: boolean;
  emailError: EmailError | null;
}
interface AuthState {
  exists: boolean;
  confirmed: boolean;
  has_password: boolean;
}
interface InvitationRow {
  id: string;
  user_id: string;
  email: string;
  auth_uid: string | null;
  status: 'pending' | 'accepted' | 'cancelled';
  register_url: string;
  expires_at: string;
  [key: string]: unknown;
}

/** Where the link opens: the admin panel that asked (its Origin), at /register. */
function registerUrl(c: AdminContext): string {
  const origin = c.req.header('origin') ?? '';
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new PosError('INVALID_REQUEST', 'send this from the admin panel: the link needs the panel’s address (Origin header)');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== origin) {
    throw new PosError('INVALID_REQUEST', 'the Origin header must be the admin panel’s address');
  }
  if (!env.adminOrigins.includes('*') && !env.adminOrigins.includes(url.origin)) {
    throw new PosError('FORBIDDEN', 'this admin panel address is not allowed (POS_ADMIN_ORIGINS)');
  }
  return `${url.origin}/register`;
}

/** type=invite: a registration link; type=recovery: a sign-in link (a new password). Both open /register. */
function linkFor(url: string, tokenHash: string, type: 'invite' | 'recovery' = 'invite'): string {
  return `${url}?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`;
}

interface AuthErrorLike {
  code?: string;
  status?: number;
  message?: string;
}
function isEmailTaken(e: AuthErrorLike | null): boolean {
  return !!e && (e.code === 'email_exists' || e.code === 'user_already_exists' || /already (been )?registered|already exists/i.test(e.message ?? ''));
}
function emailErrorKind(e: AuthErrorLike): EmailError {
  if (e.code === 'over_email_send_rate_limit' || e.status === 429) return 'rate_limited';
  if (e.code === 'email_address_not_authorized' || /not authori[sz]ed/i.test(e.message ?? '')) return 'not_allowed';
  return 'failed';
}

/**
 * Ask Supabase Auth for an invite: it emails the link when it can. When the email can't go (Supabase's built-in mailer
 * only reaches its own team, a few an hour, until a sender is set up — D-96 (4)), make the link without an email instead,
 * so the admin can copy it. Either way the same Auth account is used when one is waiting for this address.
 */
async function issueInvite(email: string, redirectTo: string): Promise<Issued> {
  const invited = await service().auth.admin.inviteUserByEmail(email, { redirectTo });
  if (!invited.error && invited.data.user) return { authUid: invited.data.user.id, tokenHash: null, emailSent: true, emailError: null };
  const inviteError = invited.error as AuthErrorLike | null;
  if (isEmailTaken(inviteError)) throw new PosError('ALREADY_EXISTS', 'someone already signs in with this email address');
  const emailError = inviteError ? emailErrorKind(inviteError) : 'failed';
  log('warn', 'registration email not sent; link made for copying', { reason: emailError, auth_code: inviteError?.code ?? null });

  const made = await service().auth.admin.generateLink({ type: 'invite', email, options: { redirectTo } });
  if (made.error || !made.data.user) {
    if (isEmailTaken(made.error as AuthErrorLike | null)) throw new PosError('ALREADY_EXISTS', 'someone already signs in with this email address');
    log('error', 'could not make a registration link', { auth_code: (made.error as AuthErrorLike | null)?.code ?? null });
    throw new PosError('UNAVAILABLE', 'Supabase Auth could not make the registration link; try again');
  }
  return { authUid: made.data.user.id, tokenHash: made.data.properties?.hashed_token ?? null, emailSent: false, emailError };
}

/** Remove an Auth account that was made for a link and never used. Missing already = fine. */
async function removeAuthAccount(authUid: string): Promise<void> {
  const { error } = await service().auth.admin.deleteUser(authUid);
  if (error && (error as AuthErrorLike).status !== 404 && !/not.?found/i.test(error.message)) {
    log('error', 'could not remove an unused auth account', { auth_uid: authUid, auth_code: (error as AuthErrorLike).code ?? null });
    throw new PosError('UNAVAILABLE', 'the old sign-in could not be removed yet; try again');
  }
}

function tokenOrFail(fromDb: string | null | undefined, fromLink: string | null, what = 'registration link'): string {
  const token = fromDb || fromLink;
  if (!token) throw new PosError('UNAVAILABLE', `the ${what} is not ready yet; try again in a moment`);
  if (fromDb && fromLink && fromDb !== fromLink) log('warn', `${what} token from the database differs from generateLink; using the database one`);
  return token;
}

/**
 * A sign-in (password-reset) link for someone who has signed up: Supabase Auth emails it when it can. When the email
 * can't go (the same limits as a registration link, D-96 (4)), the link is made without an email for Copy link. Either
 * way the token is read back from the database afterwards, so the copied link is the emailed one.
 */
async function issueSignInLink(email: string, redirectTo: string): Promise<Omit<Issued, 'authUid'>> {
  const sent = await service().auth.resetPasswordForEmail(email, { redirectTo });
  if (!sent.error) return { tokenHash: null, emailSent: true, emailError: null };
  const emailError = emailErrorKind(sent.error as AuthErrorLike);
  log('warn', 'sign-in link email not sent; link made for copying', { reason: emailError, auth_code: (sent.error as AuthErrorLike).code ?? null });
  const made = await service().auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
  if (made.error) {
    log('error', 'could not make a sign-in link', { auth_code: (made.error as AuthErrorLike | null)?.code ?? null });
    throw new PosError('UNAVAILABLE', 'Supabase Auth could not make the sign-in link; try again');
  }
  return { tokenHash: made.data.properties?.hashed_token ?? null, emailSent: false, emailError };
}

invitationRoutes.post('/invitations', admin, async (c) => {
  const body = await readJson(c, InvitationCreate);
  const redirectTo = registerUrl(c);
  // Scope and eligibility first, so no Auth account is made for someone this admin may not add.
  await adminRpc(c, 'admin_invitation_check', [[body, 'jsonb']]);
  const issued = await issueInvite(body.email, redirectTo);
  let result: { invitation: InvitationRow; user: Record<string, unknown>; token_hash: string | null };
  try {
    result = await adminRpc(c, 'admin_invitation_create', [
      [body, 'jsonb'], [issued.authUid, 'uuid'], [issued.emailSent, 'boolean'], [issued.emailError, 'text'], [redirectTo, 'text'],
    ]);
  } catch (e) {
    // Made in this request, never linked, never used: remove it so no stray sign-in exists. (pos rows are never deleted.)
    await removeAuthAccount(issued.authUid).catch(() => undefined);
    throw e;
  }
  c.header('cache-control', 'no-store');
  return c.json({
    invitation: result.invitation,
    user: result.user,
    link: linkFor(redirectTo, tokenOrFail(result.token_hash, issued.tokenHash)),
    email_sent: issued.emailSent,
    email_error: issued.emailError,
  }, 201);
});

invitationRoutes.post('/invitations/:id/resend', admin, async (c) => {
  const id = uuidParam(c, 'id');
  const redirectTo = registerUrl(c);
  const inv = await adminRpc<InvitationRow & { auth: AuthState; user_active: boolean }>(c, 'admin_invitation_get', [[id, 'uuid']]);
  if (inv.status !== 'pending') throw new PosError('CONFLICT', `this registration link was ${inv.status}`, { reason: inv.status });
  if (inv.auth.has_password) throw new PosError('CONFLICT', 'this person has already signed up', { reason: 'accepted' });
  if (!inv.user_active) throw new PosError('CONFLICT', 'this person is switched off; switch them back on first');
  // The earlier link was opened but no password was chosen: Supabase Auth won't invite a confirmed address again, so that
  // unused account is replaced by a new one.
  if (inv.auth_uid && inv.auth.exists && inv.auth.confirmed) await removeAuthAccount(inv.auth_uid);
  const issued = await issueInvite(inv.email, redirectTo);
  let result: { invitation: InvitationRow; token_hash: string | null };
  try {
    result = await adminRpc(c, 'admin_invitation_resent', [
      [id, 'uuid'], [issued.authUid, 'uuid'], [issued.emailSent, 'boolean'], [issued.emailError, 'text'], [redirectTo, 'text'],
    ]);
  } catch (e) {
    if (issued.authUid !== inv.auth_uid) await removeAuthAccount(issued.authUid).catch(() => undefined);
    throw e;
  }
  c.header('cache-control', 'no-store');
  return c.json({
    invitation: result.invitation,
    link: linkFor(redirectTo, tokenOrFail(result.token_hash, issued.tokenHash)),
    email_sent: issued.emailSent,
    email_error: issued.emailError,
  });
});

invitationRoutes.post('/invitations/:id/link', admin, async (c) => {
  const result = await adminRpc<{ invitation: InvitationRow; token_hash: string }>(c, 'admin_invitation_link', [[uuidParam(c, 'id'), 'uuid']]);
  c.header('cache-control', 'no-store');
  return c.json({ invitation: result.invitation, link: linkFor(result.invitation.register_url, result.token_hash) });
});

invitationRoutes.post('/invitations/:id/cancel', admin, async (c) => {
  const body = await readJson(c, z.object({ reason: z.string().trim().max(2000).optional() }));
  const result = await adminRpc<{ invitation: InvitationRow; remove_auth_uid: string | null }>(c, 'admin_invitation_cancel', [
    [uuidParam(c, 'id'), 'uuid'], [body.reason ?? null, 'text'],
  ]);
  if (result.remove_auth_uid) await removeAuthAccount(result.remove_auth_uid);
  return c.json(result.invitation);
});

// "Send a new sign-in link" on a person's page: for an admin or bank viewer who has signed up (forgotten password). The
// database checks actor, scope and that they have signed up before Supabase Auth is asked, and again when it is recorded.
invitationRoutes.post('/users/:id/sign-in-link', admin, async (c) => {
  const id = uuidParam(c, 'id');
  await readJson(c, z.object({}).strict());
  const redirectTo = registerUrl(c);
  const target = await adminRpc<{ user_id: string; auth_uid: string; email: string }>(c, 'admin_sign_in_link_check', [[id, 'uuid']]);
  const issued = await issueSignInLink(target.email, redirectTo);
  const result = await adminRpc<{ sign_in_link: Record<string, unknown>; token_hash: string | null }>(c, 'admin_sign_in_link_sent', [
    [id, 'uuid'], [target.auth_uid, 'uuid'], [issued.emailSent, 'boolean'], [issued.emailError, 'text'], [redirectTo, 'text'],
  ]);
  c.header('cache-control', 'no-store');
  return c.json({
    sign_in_link: result.sign_in_link,
    link: linkFor(redirectTo, tokenOrFail(result.token_hash, issued.tokenHash, 'sign-in link'), 'recovery'),
    email_sent: issued.emailSent,
    email_error: issued.emailError,
  }, 201);
});

// The new person themself (admin or bank viewer), right after choosing a password on the registration page.
invitationRoutes.post('/invitations/accept', requirePermission(null, { allowReader: true }), async (c) => {
  return c.json(await adminRpc(c, 'admin_invitation_accept'));
});
