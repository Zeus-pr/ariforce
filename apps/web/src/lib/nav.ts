import type { LucideIcon } from 'lucide-react';
import { BarChart3, CalendarRange, ClipboardList, Database, LayoutDashboard, MapPin } from 'lucide-react';

/** Provisional roles until the Architect's RBAC contract lands. */
export type Role = 'admin' | 'manager' | 'rep';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Area manager',
  rep: 'Medical rep',
};

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
  { slug: '', title: 'Dashboard', href: '/', icon: LayoutDashboard, roles: ['admin', 'manager', 'rep'] },
  {
    slug: 'masters',
    title: 'Masters',
    href: '/masters',
    icon: Database,
    roles: ['admin', 'manager'],
    issue: 8,
    blurb: 'Territories, doctors, chemists, products and the reporting hierarchy.',
  },
  {
    slug: 'attendance',
    title: 'Attendance',
    href: '/attendance',
    icon: MapPin,
    roles: ['admin', 'manager', 'rep'],
    issue: 9,
    blurb: 'Day punch-in and check-ins on a map, with out-of-geofence calls flagged.',
  },
  {
    slug: 'dcr',
    title: 'DCR',
    href: '/dcr',
    icon: ClipboardList,
    roles: ['admin', 'manager', 'rep'],
    issue: 10,
    blurb: 'Daily call reports: doctor and chemist calls, products detailed, samples given.',
  },
  {
    slug: 'tour-plans',
    title: 'Tour plans',
    href: '/tour-plans',
    icon: CalendarRange,
    roles: ['admin', 'manager', 'rep'],
    issue: 11,
    blurb: 'Monthly tour plan calendar, submission and approval.',
  },
  {
    slug: 'reports',
    title: 'Reports',
    href: '/reports',
    icon: BarChart3,
    roles: ['admin', 'manager'],
    blurb: 'Coverage, call average, frequency compliance and DCR compliance by hierarchy.',
  },
];
