// Notification delivery for the `notify` worker (docs/06 §5, D-06, D-17). Provider per channel comes from server
// setting `notify.providers` (default: log — records the would-be send and calls nobody). Push payloads are
// content-free sync hints; email text comes from content definitions (keys `<template_key>.subject|body`), with
// the bundled defaults below as fallback.
import { asService, rpc } from './db.ts';
import { PosError } from './errors.ts';
import { log } from './log.ts';

interface ForSend {
  notification: {
    id: string;
    channel: 'push' | 'email';
    template_key: string;
    payload: Record<string, unknown>;
    state: string;
    subject_type: string | null;
    subject_id: string | null;
  };
  recipient: { id?: string; email?: string | null; first_name?: string; last_name?: string; role?: string };
  push_targets: Array<{ provider: string | null; token: string }>;
  job: { id: string; reference: string; merchant_name: string; bank_id: string; scheduled_start: string | null; scheduled_end: string | null; status: string } | null;
}

interface Providers {
  push?: string;
  email?: string;
  email_from?: string;
}

const FALLBACK: Record<string, string> = {
  'notify.job_assigned.email.subject': 'New POS job {{job_reference}}',
  'notify.job_assigned.email.body': 'Hi {{first_name}},\n\nYou have been assigned job {{job_reference}} ({{merchant_name}}). Open POS in FESS to accept or reject it.',
  'notify.job_cancelled.email.subject': 'POS job {{job_reference}} cancelled',
  'notify.job_cancelled.email.body': 'Hi {{first_name}},\n\nJob {{job_reference}} ({{merchant_name}}) has been cancelled. Anything you already captured will still upload.',
  'notify.job_returned.email.subject': 'POS job {{job_reference}} returned for rework',
  'notify.job_returned.email.body': 'Hi {{first_name}},\n\nJob {{job_reference}} was returned for rework: {{note}}',
  'notify.job_rescheduled.email.subject': 'POS job {{job_reference}} rescheduled',
  'notify.job_rescheduled.email.body': 'Hi {{first_name}},\n\nThe visit window for {{job_reference}} has changed. Open POS to see the new time.',
  'notify.job_rejected_by_agent.email.subject': '{{job_reference}} rejected by the agent',
  'notify.job_rejected_by_agent.email.body': 'The assigned agent rejected {{job_reference}} (reason: {{reason_code}}). It is back in SCHEDULED for re-allocation.',
  'notify.assignment_expired.email.subject': '{{job_reference}}: no response from the agent',
  'notify.assignment_expired.email.body': 'The agent did not respond to {{job_reference}} in time. It is back in SCHEDULED for re-allocation.',
  'notify.integrity_failed.email.subject': 'Integrity failure on {{job_reference}}',
  'notify.integrity_failed.email.body': 'Evidence for {{job_reference}} failed verification. Open the review screen for details.',
};

function render(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = vars[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

async function sendEmail(provider: string, from: string | undefined, to: string, subject: string, text: string): Promise<string | null> {
  if (provider === 'log') return null;
  if (provider === 'resend') {
    const key = Deno.env.get('RESEND_API_KEY');
    if (!key || !from) throw new Error('resend provider not configured (RESEND_API_KEY / notify.providers.email_from)');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`resend responded ${res.status}`);
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return json.id ?? null;
  }
  throw new Error(`email provider ${provider} is not implemented`);
}

async function sendPush(provider: string, _token: string, _payload: Record<string, unknown>): Promise<string | null> {
  if (provider === 'log') return null;
  // fcm_v1 / onesignal need the FESS send-only credential (D-06); until then the message retries and dead-letters.
  throw new Error(`push provider ${provider} is not configured (D-06)`);
}

export async function deliver(notificationId: string, requestId: string, final: boolean): Promise<void> {
  const sys = { id: null, role: 'system', requestId };
  const data = await asService(sys, (tx) => rpc<ForSend | null>(tx, 'notification_for_send', [[notificationId, 'uuid']]));
  if (!data) throw new PosError('NOT_FOUND', `notification ${notificationId} not found`);
  const n = data.notification;
  if (n.state === 'sent' || n.state === 'dead') return;

  const [providers, strings] = await asService(sys, async (tx) => [
    ((await rpc<Providers | null>(tx, 'setting', [['notify.providers', 'text']])) ?? {}) as Providers,
    ((await rpc<Record<string, string> | null>(tx, 'content_bundle', [[data.job?.bank_id ?? null, 'uuid']])) ?? {}) as Record<string, string>,
  ] as const);
  const provider = (n.channel === 'push' ? providers.push : providers.email) ?? 'log';
  const vars: Record<string, unknown> = {
    ...n.payload,
    first_name: data.recipient.first_name,
    last_name: data.recipient.last_name,
    job_reference: data.job?.reference ?? n.payload.job_reference,
    merchant_name: data.job?.merchant_name,
  };

  try {
    let ref: string | null = null;
    if (n.channel === 'push') {
      if (data.push_targets.length === 0) {
        await asService(sys, (tx) => rpc(tx, 'notification_result', [[n.id, 'uuid'], [true, 'boolean'], ['no_target', 'text'], [null, 'text'], [null, 'text'], [false, 'boolean']]));
        return;  // push is optional; sync never depends on it (docs/03 §7)
      }
      for (const target of data.push_targets) ref = await sendPush(provider, target.token, n.payload);
    } else {
      const to = data.recipient.email;
      if (!to) {
        // permanent: retrying cannot help. Record it as failed for good (visible in the panel) and let the message go.
        await asService(sys, (tx) => rpc(tx, 'notification_result', [[n.id, 'uuid'], [false, 'boolean'], [provider, 'text'], [null, 'text'],
                                                                     ['recipient has no email address', 'text'], [true, 'boolean']]));
        return;
      }
      const subject = render(strings[`${n.template_key}.subject`] ?? FALLBACK[`${n.template_key}.subject`] ?? n.template_key, vars);
      const body = render(strings[`${n.template_key}.body`] ?? FALLBACK[`${n.template_key}.body`] ?? '', vars);
      ref = await sendEmail(provider, providers.email_from, to, subject, body);
    }
    if (provider === 'log') {
      log('info', 'notification delivered (log provider)', { request_id: requestId, notification_id: n.id, channel: n.channel, template: n.template_key });
    }
    await asService(sys, (tx) => rpc(tx, 'notification_result', [[n.id, 'uuid'], [true, 'boolean'], [provider, 'text'], [ref, 'text'], [null, 'text'], [false, 'boolean']]));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await asService(sys, (tx) => rpc(tx, 'notification_result', [[n.id, 'uuid'], [false, 'boolean'], [provider, 'text'], [null, 'text'], [error, 'text'], [final, 'boolean']]));
    throw e;
  }
}
