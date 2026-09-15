// Plain-English labels for internal values people see in the panel (D-98, docs/17 §2 rule 1). The values themselves
// (roles, permissions, reason categories, contact outcomes…) never change; only what people read.
import type {
  AssignmentResponse,
  ContactChannel,
  ContactOutcome,
  Permission,
  PosRole,
  ReasonCategory,
} from './types';
import { humanize } from './format';

export const ROLE_LABEL: Record<PosRole, string> = {
  pos_admin: 'Administrator',
  pos_bank_reader: 'Bank viewer (read only)',
  pos_agent: 'Agent',
};

export const PERMISSION_LABEL: Record<Permission, string> = {
  review_inspections: 'Review visits',
  approve_definitions: 'Approve set-up changes',
  schedule_jobs: 'Book visits with merchants',
};

/** Where each list of reasons is used, in words. */
export const REASON_CATEGORY_LABEL: Record<ReasonCategory, string> = {
  assignment_reject: 'Agent can’t take a job',
  unable_to_complete: 'Visit couldn’t be done',
  cancel: 'Job cancelled',
  geofence_override: 'Visit started away from the site',
  review_return: 'Visit sent back to the agent',
  review_reject: 'Visit rejected',
  appointment_not_secured: 'Couldn’t book a visit',
  reassign: 'Job taken off an agent',
  unschedule: 'Booking cancelled',
  envelope_resolution: 'Incoming data sorted out',
};

export const CONTACT_CHANNEL_LABEL: Record<ContactChannel, string> = {
  phone: 'Phone call',
  email: 'Email',
  whatsapp: 'WhatsApp',
  in_person: 'In person',
  other: 'Other',
};

export const CONTACT_OUTCOME_LABEL: Record<ContactOutcome, string> = {
  no_answer: 'No answer',
  declined: 'Merchant declined',
  rescheduled: 'Asked for another time',
  confirmed: 'Visit time agreed',
  wrong_number: 'Wrong number',
  other: 'Other',
};

export const ASSIGNMENT_RESPONSE_LABEL: Record<AssignmentResponse, string> = {
  pending: 'No answer yet',
  accepted: 'Accepted',
  rejected: 'Turned it down',
  expired: 'No answer in time',
  revoked: 'Taken off the agent',
};

/** A label from a map, falling back to humanize() for values the map doesn't know. */
export function labelFrom<T extends string>(map: Partial<Record<T, string>>, value: T | null | undefined): string {
  if (!value) return '—';
  return map[value] ?? humanize(value);
}
