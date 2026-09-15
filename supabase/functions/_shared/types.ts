// Hono context variables shared by every route module.

export interface AgentAuth {
  kind: 'agent';
  userId: string;
  role: 'pos_agent' | 'pos_admin';
  /** Current scope from the database (sign-out / deactivation downgrade immediately, D-35). */
  scope: 'full' | 'ingest_only';
  deviceId: string;
  sessionId: string;
  /** Claims used for RLS reads (request.jwt.claims). */
  claims: Record<string, unknown>;
}

export interface StaffAuth {
  kind: 'staff';
  /** pos_users.id — the actor passed to every pos_rpc.admin_* function. */
  userId: string;
  authUid: string;
  role: 'pos_admin' | 'pos_bank_reader';
  permissions: string[];
  bankIds: string[] | null;
  aal: string;
  email: string | null;
  firstName: string;
  lastName: string;
  /** The caller's Supabase access token (for forwarding to Auth admin checks, never logged). */
  accessToken: string;
}

/** A bank's system, by API key (T6-06, D-100): read-only, its own bank, the statuses the bank may read. */
export interface BankAuth {
  kind: 'bank';
  keyId: string;
  bankId: string;
  bankCode: string;
  statuses: string[];
  limit: number;
  remaining: number;
}

export interface AppEnv {
  Variables: {
    requestId: string;
    agent: AgentAuth;
    staff: StaffAuth;
    bank: BankAuth;
    /** How many records a bank call returned, for its call record. */
    bankItems: number;
    /** The inspection a bank call was about, for its call record. */
    bankSubject: string;
  };
}
