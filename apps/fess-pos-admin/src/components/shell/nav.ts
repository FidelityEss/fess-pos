// Navigation config and route access rules. Hiding a nav item is UX only — the API and RLS enforce access.
import {
  BellRing,
  Briefcase,
  ClipboardCheck,
  Database,
  FileCode,
  FileDown,
  History,
  Inbox,
  KeyRound,
  Landmark,
  LayoutDashboard,
  ListTree,
  type LucideIcon,
  Package,
  ScrollText,
  SlidersHorizontal,
  Smartphone,
  Store,
  Tags,
  Terminal,
  Users,
} from 'lucide-react';
import { useCallback } from 'react';
import { env, type EnvName } from '@/lib/env';
import { type StaffContextValue, useStaff } from '@/lib/staff';
import type { Permission } from '@/lib/types';

/** Who may open a screen. Default (empty rule) = any pos_admin; bank readers only where `readers: true`. */
export interface AccessRule {
  readers?: boolean;
  permission?: Permission;
  globalAdmin?: boolean;
  /** Hidden when NEXT_PUBLIC_ENV_NAME=production. */
  devOnly?: boolean;
}

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  access: AccessRule;
  /** Technical screen: listed only in Advanced view (T2-24). Still reachable by link in Basic view. */
  advanced?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  { label: 'Overview', items: [{ href: '/', label: 'Dashboard', icon: LayoutDashboard, access: { readers: true } }] },
  {
    label: 'Operations',
    items: [
      { href: '/jobs', label: 'Jobs', icon: Briefcase, access: { readers: true } },
      { href: '/review', label: 'Review queue', icon: ClipboardCheck, access: { permission: 'review_inspections' } },
      { href: '/alerts', label: 'Alerts', icon: BellRing, access: {} },
      { href: '/envelopes', label: 'Envelope inbox', icon: Inbox, access: {}, advanced: true },
      { href: '/custody', label: 'Custody', icon: Database, access: {}, advanced: true },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { href: '/definitions', label: 'Forms & screens', icon: FileCode, access: {} },
      { href: '/config', label: 'App settings', icon: SlidersHorizontal, access: {} },
      { href: '/reason-codes', label: 'Reason codes', icon: Tags, access: {} },
      { href: '/lookup-lists', label: 'Lookup lists', icon: ListTree, access: {} },
      { href: '/declarations', label: 'Declarations', icon: ScrollText, access: {}, advanced: true },
      { href: '/mcc', label: 'MCC codes', icon: Store, access: {}, advanced: true },
    ],
  },
  {
    label: 'Administration',
    items: [
      { href: '/banks', label: 'Banks', icon: Landmark, access: {} },
      { href: '/users', label: 'Users', icon: Users, access: {} },
      { href: '/exports', label: 'Exports', icon: FileDown, access: { readers: true } },
      { href: '/issuers', label: 'Trusted issuers', icon: KeyRound, access: { globalAdmin: true }, advanced: true },
      { href: '/devices', label: 'Devices & sessions', icon: Smartphone, access: {}, advanced: true },
      { href: '/releases', label: 'Module releases', icon: Package, access: {}, advanced: true },
      { href: '/audit', label: 'Audit log', icon: History, access: {}, advanced: true },
    ],
  },
  { label: 'Dev tools', items: [{ href: '/dev-tools', label: 'Dev tools', icon: Terminal, access: { devOnly: true }, advanced: true }] },
];

const ALL_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Sub-routes whose access differs from their nav item (write screens under readable sections). */
const ROUTE_RULES: { pattern: RegExp; access: AccessRule }[] = [
  { pattern: /^\/jobs\/new\/?$/, access: {} },
  { pattern: /^\/jobs\/import\/?$/, access: {} },
  { pattern: /^\/jobs\/[^/]+\/edit\/?$/, access: {} },
];

type StaffAccess = Pick<StaffContextValue, 'isAdmin' | 'isReader' | 'isGlobalAdmin' | 'hasPermission'>;

/** Evaluate an access rule for a staff member. */
export function canAccess(rule: AccessRule, staff: StaffAccess, envName: EnvName = env.envName): boolean {
  if (rule.devOnly && envName === 'production') return false;
  if (staff.isReader) return rule.readers === true;
  if (!staff.isAdmin) return false;
  if (rule.globalAdmin && !staff.isGlobalAdmin) return false;
  if (rule.permission && !staff.hasPermission(rule.permission)) return false;
  return true;
}

/** True when the nav item is the current section. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.href === '/') return pathname === '/';
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The nav item owning a path (longest matching prefix). */
export function findNavItem(pathname: string): NavItem | undefined {
  return ALL_ITEMS.filter((i) => isNavItemActive(i, pathname)).sort((a, b) => b.href.length - a.href.length)[0];
}

/** Access rule for a path, or null for unknown paths (left to the page / 404). */
export function accessRuleForPath(pathname: string): AccessRule | null {
  const special = ROUTE_RULES.find((r) => r.pattern.test(pathname));
  if (special) return special.access;
  return findNavItem(pathname)?.access ?? null;
}

/** Hook: `(path) => boolean` — whether the signed-in staff member may open a path. */
export function useCanAccessPath(): (pathname: string) => boolean {
  const staff = useStaff();
  return useCallback(
    (pathname: string) => {
      const rule = accessRuleForPath(pathname.split('?')[0] ?? pathname);
      return rule === null ? true : canAccess(rule, staff);
    },
    [staff],
  );
}
