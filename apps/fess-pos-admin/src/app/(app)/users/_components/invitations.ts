'use client';

// Registration links (D-96, T2-37) for the People screens: the API calls, the "waiting to sign up" list and plain words
// for what can go wrong. A link is a credential until it is used, so the screens call these directly (never through
// useMutation) and keep a link only in the state of the dialog that shows it.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, isApiError } from '@/lib/api';
import { callRpc } from '@/lib/supabase';
import type { Permission, PosRole, Uuid } from '@/lib/types';
import { isPlainObject } from '@/lib/utils';

/** Why a link wasn't emailed (pos.admin_invitations.email_error). */
export type EmailProblem = 'not_allowed' | 'rate_limited' | 'failed';

/** One row of pos.admin_invitations_waiting(): a link sent to someone who hasn't chosen a password yet. */
export interface WaitingInvitation {
  id: Uuid;
  user_id: Uuid;
  email: string;
  first_name: string;
  last_name: string;
  role: PosRole;
  bank_ids: Uuid[] | null;
  email_sent: boolean;
  email_error: EmailProblem | null;
  send_count: number;
  last_sent_at: string;
  expires_at: string;
  expired: boolean;
  /** The link was opened (the address confirmed) but no password was chosen. */
  opened: boolean;
  link_copies: number;
  invited_by: Uuid;
  invited_by_name: string;
  created_at: string;
  can_manage: boolean;
}

export interface InvitationRecord {
  id: Uuid;
  user_id: Uuid;
  email: string;
  status: 'pending' | 'accepted' | 'cancelled';
  email_sent: boolean;
  email_error: EmailProblem | null;
  send_count: number;
  last_sent_at: string;
  expires_at: string;
}

export interface LinkResult {
  invitation: InvitationRecord;
  link: string;
  email_sent?: boolean;
  email_error?: EmailProblem | null;
  user?: { id: Uuid; first_name: string; last_name: string };
}

export interface InvitePerson {
  employee_number?: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  role: 'pos_admin' | 'pos_bank_reader';
  permissions: Permission[];
  bank_ids: Uuid[] | null;
}

export type InviteBody = { email: string; user_id: Uuid } | { email: string; person: InvitePerson };

const BASE = '/v1/admin/invitations';
const seg = encodeURIComponent;

export const invitationsApi = {
  /** Add the person when new, and send their link (or make it for copying when email can't go). */
  send: (body: InviteBody) => api<LinkResult>('POST', BASE, body),
  /** A new link; the earlier one stops working. */
  resend: (id: string) => api<LinkResult>('POST', `${BASE}/${seg(id)}/resend`, {}),
  /** The link that is waiting (the emailed one). Copying doesn't change it. */
  copyLink: (id: string) => api<LinkResult>('POST', `${BASE}/${seg(id)}/link`, {}),
  cancel: (id: string, reason?: string) => api<InvitationRecord>('POST', `${BASE}/${seg(id)}/cancel`, reason ? { reason } : {}),
};

export const waitingKey = (userId?: string | null) => ['invitations', 'waiting', userId ?? 'all'] as const;

/** Links still waiting (optionally for one person). Admins only; the database returns [] for anyone else. */
export function useWaitingInvitations(userId?: string | null, enabled = true) {
  return useQuery({
    queryKey: waitingKey(userId),
    queryFn: () => callRpc<WaitingInvitation[]>('admin_invitations_waiting', userId ? { p_user_id: userId } : {}),
    enabled,
  });
}

/** Refresh everything that shows sign-in state after a link changes. */
export function useRefreshPeople(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['invitations'] });
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  }, [queryClient]);
}

export const EMAIL_PROBLEM: Record<EmailProblem, string> = {
  not_allowed: 'Email sending isn’t set up for this environment yet, so it couldn’t be emailed.',
  rate_limited: 'Too many emails went out in the last hour, so it couldn’t be emailed.',
  failed: 'The email couldn’t be sent (email sending may not be set up yet).',
};

/** Plain words for a refused link action (the API's CONFLICT with details.reason), or null for other errors. */
export function linkProblem(error: unknown): string | null {
  if (!isApiError(error)) return null;
  const reason = isPlainObject(error.details) ? error.details.reason : undefined;
  switch (reason) {
    case 'expired':
      return 'This link has expired. Use Resend to send a new one.';
    case 'used':
      return 'This link has already been opened. If they didn’t finish, use Resend to send a new one.';
    case 'cancelled':
      return 'This link was cancelled.';
    case 'accepted':
      return 'They’ve already signed up.';
    default:
      return null;
  }
}

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
