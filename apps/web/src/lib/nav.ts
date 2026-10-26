import type { LucideIcon } from 'lucide-react';
import { BarChart3, CalendarRange, ClipboardList, Database, LayoutDashboard, MapPin } from 'lucide-react';

import { ROLES, isApprover, isSystemAdmin, type Role } from './roles';

export { ROLE_LABEL, type Role } from './roles';

const SALES = ROLES.filter((r) => !isSystemAdmin(r));
const APPROVERS = ROLES.filter(isApprover);

export type NavItem = {
  slug: string;
  title: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  issue?: number;
  blurb?: string;
};

export const NAV: NavItem[] = [
  { slug: '', title: 'Dashboard', href: '/', icon: LayoutDashboard, roles: SALES },
  {
    slug: 'masters',
    title: 'Masters',
    href: '/masters',
    icon: Database,
    roles: ['system_admin'],
    issue: 8,
    blurb: 'Territories, doctors, chemists, products and the reporting hierarchy.',
  },
  {
    slug: 'attendance',
    title: 'Attendance',
    href: '/attendance',
    icon: MapPin,
    roles: SALES,
    issue: 9,
    blurb: 'Day punch-in and check-ins on a map, with out-of-geofence calls flagged.',
  },
  {
    slug: 'dcr',
    title: 'DCR',
    href: '/dcr',
    icon: ClipboardList,
    roles: SALES,
    issue: 10,
    blurb: 'Daily call reports: doctor and chemist calls, products detailed, samples given.',
  },
  {
    slug: 'tour-plans',
    title: 'Tour plans',
    href: '/tour-plans',
    icon: CalendarRange,
    roles: SALES,
    issue: 11,
    blurb: 'Monthly tour plan calendar, submission and approval.',
  },
  {
    slug: 'reports',
    title: 'Reports',
    href: '/reports',
    icon: BarChart3,
    roles: APPROVERS,
    blurb: 'Coverage, call average, frequency compliance and DCR compliance by hierarchy.',
  },
];

/** Where a role lands after sign-in: the first nav item it can see. */
export function homeFor(role: Role): string {
  return NAV.find((n) => n.roles.includes(role))?.href ?? '/';
}

export function canSee(role: Role, pathname: string): boolean {
  const item = [...NAV].sort((a, b) => b.href.length - a.href.length).find((n) => (n.href === '/' ? pathname === '/' : pathname.startsWith(n.href)));
  return !item || item.roles.includes(role);
}
