import type { LucideIcon } from 'lucide-react';
import {
  UserPlus,
  CalendarRange,
  Pill,
  Package,
  Network,
  FileSpreadsheet,
  Stethoscope,
  IndianRupee,
  Target,
  ChartNoAxesColumn,
  CircleAlert,
  ClipboardList,
  LayoutDashboard,
  MapPin,
  ReceiptText,
} from 'lucide-react';

import { seesExpenses } from './expenses/model';

import { WRITE_ROUTES, canReviewSignups } from './permissions';
import { ROLES, isApprover, isSystemAdmin, type Role } from './roles';

export { ROLE_LABEL, type Role } from './roles';

export const SALES = ROLES.filter((r) => !isSystemAdmin(r));
export const APPROVERS = ROLES.filter(isApprover);

export type NavSectionId =
  'workspace' | 'field' | 'business' | 'performance' | 'intelligence' | 'admin';

/** Sidebar sections, in order. A section with no item visible to the role is not rendered. */
export const NAV_SECTIONS: { id: NavSectionId; title: string }[] = [
  { id: 'workspace', title: 'Workspace' },
  { id: 'field', title: 'Field Force' },
  { id: 'business', title: 'Business' },
  { id: 'performance', title: 'Performance' },
  { id: 'intelligence', title: 'Intelligence' },
  { id: 'admin', title: 'Administration' },
];

export type NavItem = {
  slug: string;
  title: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  section: NavSectionId;
};

/**
 * Only pages that exist are listed; each new page adds itself here when it ships.
 * Managers' pages show their team; a Business Manager sees their own numbers on the same page.
 */
export const NAV: NavItem[] = [
  {
    slug: '',
    title: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
    roles: SALES,
    section: 'workspace',
  },
  {
    slug: 'attendance',
    title: 'Attendance',
    href: '/attendance',
    icon: MapPin,
    roles: SALES,
    section: 'field',
  },
  { slug: 'dcr', title: 'DCR', href: '/dcr', icon: ClipboardList, roles: SALES, section: 'field' },
  {
    slug: 'tour-plans',
    title: 'Tour Plans',
    href: '/tour-plans',
    icon: CalendarRange,
    roles: SALES,
    section: 'field',
  },
  {
    slug: 'expenses',
    title: 'Expenses',
    href: '/expenses',
    icon: ReceiptText,
    roles: ROLES.filter(seesExpenses),
    section: 'field',
  },
  {
    slug: 'doctors',
    title: 'Doctors',
    href: '/doctors',
    icon: Stethoscope,
    roles: [...ROLES],
    section: 'business',
  },
  {
    slug: 'chemists',
    title: 'Chemists',
    href: '/chemists',
    icon: Pill,
    roles: [...ROLES],
    section: 'business',
  },
  {
    slug: 'stockists',
    title: 'Stockists',
    href: '/stockists',
    icon: Package,
    roles: [...ROLES],
    section: 'business',
  },
  {
    slug: 'sales',
    title: 'Sales',
    href: '/sales',
    icon: IndianRupee,
    roles: SALES,
    section: 'performance',
  },
  {
    slug: 'coverage',
    title: 'Coverage',
    href: '/coverage',
    icon: Target,
    roles: SALES,
    section: 'performance',
  },
  {
    slug: 'team',
    title: 'Team Performance',
    href: '/team',
    icon: ChartNoAxesColumn,
    roles: APPROVERS,
    section: 'performance',
  },
  {
    slug: 'reports',
    title: 'Reports',
    href: '/reports',
    icon: FileSpreadsheet,
    roles: SALES,
    section: 'performance',
  },
  {
    slug: 'exceptions',
    title: 'Exceptions',
    href: '/exceptions',
    icon: CircleAlert,
    roles: SALES,
    section: 'intelligence',
  },
  {
    slug: 'my-team',
    title: 'My Team',
    href: '/my-team',
    icon: Network,
    roles: APPROVERS,
    section: 'admin',
  },
  {
    slug: 'sign-up-requests',
    title: 'Sign-up requests',
    href: '/sign-up-requests',
    icon: UserPlus,
    roles: ROLES.filter(canReviewSignups),
    section: 'admin',
  },
];

/** Where a role lands after sign-in: the first nav item it can see. */
export function homeFor(role: Role): string {
  return NAV.find((n) => n.roles.includes(role))?.href ?? '/';
}

/**
 * Route guard table: the sidebar items, the masters lists (readable by every sales role; the sidebar
 * shows Doctors at /doctors, Chemists and Stockists here) and the write-only routes from lib/permissions.
 * Longest prefix wins.
 */
export const GUARDS: { href: string; roles: readonly Role[] }[] = [
  // Doctors, Chemists and Stockists are readable by every role; their /{kind}/import needs a writer.
  ...NAV,
  ...WRITE_ROUTES,
];

export function canSee(role: Role, pathname: string): boolean {
  const item = [...GUARDS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((n) => (n.href === '/' ? pathname === '/' : pathname.startsWith(n.href)));
  return !item || item.roles.includes(role);
}
