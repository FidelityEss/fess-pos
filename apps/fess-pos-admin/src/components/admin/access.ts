// Client-side mirrors of the D-44 scope rules. UX only — every write is re-checked by pos_rpc.admin_* in the database.
import type { StaffContextValue } from '@/lib/staff';
import type { PosRole, Uuid } from '@/lib/types';

type Staff = Pick<StaffContextValue, 'me' | 'isAdmin' | 'isGlobalAdmin' | 'canAccessBank'>;

/**
 * D-44 (2), mirrors pos_rpc.admin_can_manage_user: all-bank admins manage anyone; bank-scoped admins manage only agents
 * and bank readers whose banks are a non-empty subset of their own.
 */
export function canManageUser(staff: Staff, role: PosRole, bankIds: readonly Uuid[] | null): boolean {
  if (!staff.isAdmin) return false;
  if (staff.isGlobalAdmin) return true;
  const mine = staff.me.bank_ids ?? [];
  return role !== 'pos_admin' && bankIds !== null && bankIds.length > 0 && bankIds.every((b) => mine.includes(b));
}

/** A write to a row that is global (bankId null → all-bank admin, D-44 (1)) or belongs to one bank (admin in that bank). */
export function canWriteScoped(staff: Staff, bankId: Uuid | null): boolean {
  if (!staff.isAdmin) return false;
  return bankId === null ? staff.isGlobalAdmin : staff.canAccessBank(bankId);
}

/** Roles this staff member may give a user (D-44 (2): bank-scoped admins never create or edit admins). */
export function assignableRoles(staff: Staff): PosRole[] {
  if (!staff.isAdmin) return [];
  return staff.isGlobalAdmin ? ['pos_agent', 'pos_admin', 'pos_bank_reader'] : ['pos_agent', 'pos_bank_reader'];
}

export const GLOBAL_ADMIN_ONLY = 'Only an administrator who covers all banks can change this.';
