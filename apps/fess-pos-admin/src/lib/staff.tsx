'use client';

// The signed-in staff member (GET /v1/admin/me) and permission helpers, provided by <AuthGate>.
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { fullName } from './format';
import type { Me, Permission } from './types';

export interface StaffContextValue {
  me: Me;
  /** role === 'pos_admin'. */
  isAdmin: boolean;
  /** role === 'pos_bank_reader' (GET endpoints only). */
  isReader: boolean;
  /** pos_admin with bank_ids === null (all banks). */
  isGlobalAdmin: boolean;
  /** Admin holding the permission (readers never do). */
  hasPermission: (permission: Permission) => boolean;
  /** Whether a bank is in this staff member's scope (null bank_ids = all). */
  canAccessBank: (bankId: string | null | undefined) => boolean;
  displayName: string;
}

/** Build the context value from a /me result (pure; exported for tests). */
export function buildStaffContext(me: Me): StaffContextValue {
  const isAdmin = me.role === 'pos_admin';
  const isReader = me.role === 'pos_bank_reader';
  return {
    me,
    isAdmin,
    isReader,
    isGlobalAdmin: isAdmin && me.bank_ids === null,
    hasPermission: (p) => isAdmin && me.permissions.includes(p),
    canAccessBank: (bankId) => me.bank_ids === null || (!!bankId && me.bank_ids.includes(bankId)),
    displayName: fullName(me),
  };
}

const StaffContext = createContext<StaffContextValue | null>(null);

/** Provides the staff context to the app shell. Rendered by <AuthGate> once /me succeeds. */
export function StaffProvider({ me, children }: { me: Me; children: ReactNode }) {
  const value = useMemo(() => buildStaffContext(me), [me]);
  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
}

/** The staff context. Throws outside <AuthGate> (i.e. on /sign-in or /mfa). */
export function useStaff(): StaffContextValue {
  const ctx = useContext(StaffContext);
  if (!ctx) throw new Error('useStaff() must be used inside <AuthGate>/<StaffProvider>.');
  return ctx;
}

/** The /me result for the signed-in staff member. */
export function useMe(): Me {
  return useStaff().me;
}
