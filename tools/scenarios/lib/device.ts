// A simulated module on a phone: exchange, pull (cursors + "have"), envelopes hashed exactly as the module hashes
// them (the TS engine's JCS + SHA-256), upload grants and signed uploads. Used by the smoke test and the seeder.
import { createClient } from '@supabase/supabase-js';
import * as engine from '../../../packages/fess_pos_engine_ts/src/index.ts';
import { call } from './api.ts';
import { env } from './env.ts';
import { isoSast, uuidv7 } from './util.ts';

export interface SessionInfo {
  access_token: string;
  refresh_token: string;
  session_id: string;
  scope: 'full' | 'ingest_only';
  user: { id: string; employee_number: string; first_name: string; last_name: string; role: string };
}

export interface SyncJob {
  id: string;
  reference: string;
  status: string;
  bank: { id: string; code: string; name: string };
  merchant_name: string;
  address: Record<string, unknown>;
  location: { lat: number; lng: number } | null;
  location_type: string;
  mcc: { code: string; description: string } | null;
  attributes: Record<string, unknown>;
  scheduled_start: string | null;
  scheduled_end: string | null;
  assigned_to_me: boolean;
  attempts: number;
  job_schema_version_id: string | null;
  [k: string]: unknown;
}

export interface ManifestEntry {
  context_bank_id: string | null;
  kind: string;
  key: string;
  family_id: string;
  version_id: string;
  version: number;
  definition_hash: string;
}

export interface DefinitionBody {
  id: string;
  kind: string;
  key: string;
  definition: Record<string, unknown>;
  definition_hash: string;
}

export interface Receipt {
  id: string | null;
  state: string | null;
  durable: boolean;
  stored_hash?: string | null;
  result?: Record<string, unknown> | null;
  error?: { code: string; message: string } | null;
  waiting_on?: Record<string, unknown> | null;
}

export type Envelope = Record<string, unknown> & { id: string; type: string; payload: Record<string, unknown>; payload_hash: string };

export class Device {
  readonly deviceId = crypto.randomUUID();
  seq = 0;
  mono = 1_000;
  session?: SessionInfo;
  cursors: Record<string, string> = {};
  jobs = new Map<string, SyncJob>();
  manifest: ManifestEntry[] = [];
  defs = new Map<string, DefinitionBody>();
  declarations = new Map<string, { id: string; key: string; version: number }>();
  tokens = new Map<string, { token: string; token_id: string }>();
  jobCards = new Map<string, string>();
  agentCard?: { token: string; valid_to: string };
  config: { default?: { config_version_id: string | null; values: Record<string, unknown> }; by_bank: Record<string, { config_version_id: string | null; values: Record<string, unknown> }> } = { by_bank: {} };
  reasonCodesHash?: string;
  me?: Record<string, unknown>;
  totals: Record<string, number> = {};
  envelopeOutcomes = new Map<string, Record<string, unknown>>();
  evidenceStatus = new Map<string, string>();
  reviews: Record<string, unknown>[] = [];

  constructor(readonly label: string, readonly model = 'Tecno Spark 10 Pro') {}

  get access(): string {
    if (!this.session) throw new Error(`${this.label}: not signed in`);
    return this.session.access_token;
  }

  get userId(): string {
    if (!this.session) throw new Error(`${this.label}: not signed in`);
    return this.session.user.id;
  }

  deviceInfo(): Record<string, unknown> {
    return {
      device_id: this.deviceId, client_type: 'native', platform: 'android', model: this.model, os_version: '13',
      host_app_version: '7.4.0', module_version: '0.1.0',
      capabilities: { module_version: '0.1.0', api_versions: ['1'], spec_versions: ['1.0'], client_type: 'native', platform: 'android' },
    };
  }

  async exchange(hostToken: string, profile?: Record<string, string>): Promise<SessionInfo> {
    this.session = await call<SessionInfo>('POST', '/v1/auth/exchange', {
      body: { issuer: 'pos_dev', token: hostToken, issued_at: new Date().toISOString(), device: this.deviceInfo(), ...(profile ? { profile } : {}) },
    });
    return this.session;
  }

  async refresh(): Promise<SessionInfo> {
    this.session = await call<SessionInfo>('POST', '/v1/auth/refresh', {
      body: { refresh_token: this.session?.refresh_token, device_id: this.deviceId },
    });
    return this.session;
  }

  have(): Record<string, unknown> {
    return {
      definition_version_ids: [...this.defs.keys()],
      declaration_ids: [...this.declarations.values()].map((d) => d.id),
      ...(this.reasonCodesHash ? { reason_codes_hash: this.reasonCodesHash } : {}),
      session_token_job_ids: [...this.tokens.keys()],
      job_card_job_ids: [...this.jobCards.keys()],
      agent_card_valid: !!this.agentCard && Date.parse(this.agentCard.valid_to) > Date.now(),
    };
  }

  // deno-lint-ignore no-explicit-any
  async pull(): Promise<any> {
    // deno-lint-ignore no-explicit-any
    let last: any;
    for (let page = 0; page < 20; page++) {
      // deno-lint-ignore no-explicit-any
      const res = await call<any>('POST', '/v1/sync/pull', { bearer: this.access, body: { cursors: this.cursors, have: this.have(), limit: 200 } });
      last = res;
      for (const j of res.jobs.items) this.jobs.set(j.id, j);
      this.manifest = res.definitions.manifest;
      for (const b of res.definitions.bodies) this.defs.set(b.id, b);
      for (const d of res.declarations.bodies) this.declarations.set(d.key, d);
      if (res.reason_codes.items) this.reasonCodesHash = res.reason_codes.hash;
      for (const t of res.session_tokens) this.tokens.set(t.job_id, { token: t.token, token_id: t.token_id });
      for (const t of res.job_cards) this.jobCards.set(t.job_id, t.token);
      if (res.agent_card) this.agentCard = res.agent_card;
      this.config = res.config;
      this.me = res.me;
      this.totals = res.agent_totals;
      for (const e of res.envelopes.items) this.envelopeOutcomes.set(e.id, e);
      for (const e of res.evidence.items) this.evidenceStatus.set(e.id, e.upload_state);
      this.reviews.push(...res.reviews.items);
      for (const k of ['jobs', 'reviews', 'evidence', 'envelopes']) if (res[k].next_cursor) this.cursors[k] = res[k].next_cursor;
      if (!res.jobs.has_more && !res.reviews.has_more && !res.evidence.has_more && !res.envelopes.has_more) break;
    }
    return last;
  }

  /** The definition in force for a job: the bank context if it has one, else the default context. */
  definitionFor(kind: string, key: string, bankId: string | null): DefinitionBody {
    const entry = this.manifest.find((m) => m.kind === kind && m.key === key && m.context_bank_id === bankId)
      ?? this.manifest.find((m) => m.kind === kind && m.key === key && m.context_bank_id === null);
    if (!entry) throw new Error(`${this.label}: no ${kind}/${key} definition delivered`);
    const body = this.defs.get(entry.version_id);
    if (!body) throw new Error(`${this.label}: body for ${kind}/${key} ${entry.version_id} missing`);
    return body;
  }

  async envelope(type: string, payload: Record<string, unknown>, at = new Date()): Promise<Envelope> {
    this.mono += 1_500;
    return {
      api_version: '1', id: uuidv7(at.getTime()), type, type_version: 1,
      payload_hash: await engine.payloadHash(payload),
      device_id: this.deviceId, session_id: this.session?.session_id ?? null, device_seq: ++this.seq,
      module_version: '0.1.0', client_type: 'native', created_at_device: isoSast(at), monotonic_ms: this.mono, payload,
    };
  }

  async ingest(envelopes: Envelope[]): Promise<Receipt[]> {
    const res = await call<{ receipts: Receipt[] }>('POST', '/v1/ingest', { bearer: this.access, body: { envelopes } });
    res.receipts.forEach((r, i) => {
      // G3: the device checks the server stored exactly what it sent before trusting a receipt (docs/12 §4)
      if (r.durable && r.stored_hash && r.stored_hash !== envelopes[i].payload_hash) {
        throw new Error(`${this.label}: stored_hash mismatch on ${envelopes[i].type} ${envelopes[i].id}`);
      }
    });
    return res.receipts;
  }

  async send(type: string, payload: Record<string, unknown>, at = new Date()): Promise<Receipt> {
    const [r] = await this.ingest([await this.envelope(type, payload, at)]);
    return r;
  }

  /** Upload grant + signed upload of the exact bytes; returns the grant state. */
  async upload(evidenceId: string, bytes: Uint8Array, mime: string): Promise<string> {
    const g = await call<{ state: string; bucket: string; path: string; token: string }>('POST', '/v1/evidence/upload-grant', {
      bearer: this.access, body: { evidence_id: evidenceId },
    });
    if (g.state !== 'upload') return g.state;
    const sb = createClient(env.supabaseUrl, env.publishableKey, { auth: { persistSession: false } });
    const { error } = await sb.storage.from(g.bucket).uploadToSignedUrl(g.path, g.token, bytes, { contentType: mime });
    if (error) throw new Error(`${this.label}: upload failed: ${error.message}`);
    return 'uploaded';
  }

  async signout(): Promise<{ scope: string }> {
    return await call<{ scope: string }>('POST', '/v1/auth/signout', { bearer: this.access, body: {} });
  }
}
