// Navigation config and route access rules. Hiding a nav item is UX only — the API and RLS enforce access.
// Names and sentences are plain English (D-98, docs/17 §4.4); the routes and internal names don't change.
import {
  BellRing,
  Briefcase,
  CircleHelp,
  ClipboardCheck,
  Database,
  FileCode,
  FileDown,
  History,
  House,
  Inbox,
  KeyRound,
  Landmark,
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
  /** One plain sentence: what the screen is for and what you'd do there (docs/17 §2 rule 2). Shown under the page title. */
  description: string;
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
  {
    label: 'Daily work',
    items: [
      { href: '/', label: 'Home', icon: House, access: { readers: true }, description: 'What needs your attention today. Each item opens the screen that deals with it.' },
      {
        href: '/jobs',
        label: 'Jobs',
        icon: Briefcase,
        access: { readers: true },
        description: 'Every merchant visit: create a job, book a time with the merchant, give it to an agent and follow it to the end.',
      },
      {
        href: '/review',
        label: 'To review',
        icon: ClipboardCheck,
        access: { permission: 'review_inspections' },
        description: 'Finished visits waiting for someone to check the answers and photos and approve them.',
      },
      {
        href: '/alerts',
        label: 'Alerts',
        icon: BellRing,
        access: {},
        description: 'Problems the system noticed, such as a phone that stopped sending. Mark each one as dealt with once it is sorted.',
      },
    ],
  },
  {
    label: 'Set-up',
    items: [
      {
        href: '/definitions',
        label: 'Inspection set-up',
        icon: FileCode,
        access: {},
        description: 'What agents see and fill in: the job information, the questions, the visit steps, the app screens and the wording.',
      },
      {
        href: '/config',
        label: 'App settings',
        icon: SlidersHorizontal,
        access: {},
        description: 'How the phone app behaves: location checks, photos, syncing and more, for everyone or for one bank.',
      },
      {
        href: '/reason-codes',
        label: 'Reasons',
        icon: Tags,
        access: {},
        description: 'The reasons people pick from, such as why a job was cancelled or why an agent can’t take a job.',
      },
      {
        href: '/lookup-lists',
        label: 'Drop-down lists',
        icon: ListTree,
        access: {},
        description: 'Lists of choices used in the questions, such as provinces or card machine models.',
      },
      {
        href: '/declarations',
        label: 'Declarations',
        icon: ScrollText,
        access: {},
        advanced: true,
        description: 'The statement an agent agrees to before sending a visit in.',
      },
      {
        href: '/mcc',
        label: 'Business types',
        icon: Store,
        access: {},
        advanced: true,
        description: 'The card-industry codes (MCC) for the kinds of business a merchant runs, and how risky each one is.',
      },
    ],
  },
  {
    label: 'Organisation',
    items: [
      {
        href: '/banks',
        label: 'Banks',
        icon: Landmark,
        access: {},
        description: 'The banks you do visits for: their contacts, what is billed, and whether changes need a second person to approve them.',
      },
      {
        href: '/users',
        label: 'People',
        icon: Users,
        access: {},
        description: 'Who can use the admin panel, and the agents who do the visits.',
      },
      {
        href: '/exports',
        label: 'Exports',
        icon: FileDown,
        access: { readers: true },
        description: 'Ask for visit data, such as the answers or the photos, for a bank or a period, and follow it here.',
      },
    ],
  },
  {
    label: 'Behind the scenes',
    items: [
      {
        href: '/envelopes',
        label: 'Incoming data',
        icon: Inbox,
        access: {},
        advanced: true,
        description: 'Everything the phones sent, as it arrived. Use it to find and fix data that couldn’t be saved.',
      },
      {
        href: '/custody',
        label: 'Data delivery',
        icon: Database,
        access: {},
        advanced: true,
        description: 'Whether every photo and answer from the phones safely reached us, and what is still on its way.',
      },
      {
        href: '/devices',
        label: 'Phones and sign-ins',
        icon: Smartphone,
        access: {},
        advanced: true,
        description: 'The phones agents use and who is signed in. Sign a phone out or block it here.',
      },
      {
        href: '/releases',
        label: 'App versions',
        icon: Package,
        access: {},
        advanced: true,
        description: 'Which versions of the phone app agents may use, and which must be updated.',
      },
      {
        href: '/issuers',
        label: 'Sign-in sources',
        icon: KeyRound,
        access: { globalAdmin: true },
        advanced: true,
        description: 'The systems we trust to confirm who an agent is when they sign in to the app.',
      },
      {
        href: '/audit',
        label: 'Activity history',
        icon: History,
        access: {},
        advanced: true,
        description: 'Who did what, and when. Every change made in the panel is recorded here.',
      },
    ],
  },
  {
    label: 'Help',
    items: [
      { href: '/help', label: 'Help and glossary', icon: CircleHelp, access: { readers: true }, description: 'What the words in this panel mean, and where to find things.' },
      {
        href: '/dev-tools',
        label: 'Developer tools',
        icon: Terminal,
        access: { devOnly: true },
        advanced: true,
        description: 'Test helpers for this environment. They never appear on production.',
      },
    ],
  },
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

/** The nav item for a route by its href, e.g. navItem('/review')?.label → "To review". */
export function navItem(href: string): NavItem | undefined {
  return ALL_ITEMS.find((i) => i.href === href);
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
