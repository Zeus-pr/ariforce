import * as z from 'zod';
import { Id } from './common';

/**
 * Sales hierarchy, lowest (1) to highest (8). Each role sees its own reporting-line subtree
 * (users.manager_id); director sees the whole company.
 */
export const HIERARCHY_ROLE_KEYS = [
  'business_manager',
  'area_business_manager',
  'regional_business_manager',
  'zonal_business_manager',
  'sales_manager',
  'general_manager',
  'vice_president',
  'director',
] as const;
/** Technical, non-hierarchy role: users and masters, no reporting line, no field data unless granted. */
export const SYSTEM_ADMIN = 'system_admin' as const;
/**
 * Functional roles outside the sales hierarchy (rank 0, like system_admin): no reporting line, never
 * a manager or approver, not shown in the team tree. Data scope = company-wide read of their own
 * domain permission only (sales:read / finance:read); no field, doctor or chemist data by default.
 */
export const FUNCTIONAL_ROLE_KEYS = ['distribution_head', 'accountant'] as const;
export const NON_HIERARCHY_ROLE_KEYS = [SYSTEM_ADMIN, ...FUNCTIONAL_ROLE_KEYS] as const;
export const ROLE_KEYS = [...HIERARCHY_ROLE_KEYS, ...NON_HIERARCHY_ROLE_KEYS] as const;
export const RoleKey = z.enum(ROLE_KEYS).meta({ id: 'RoleKey' });
export type RoleKey = z.infer<typeof RoleKey>;

export const ROLE_NAMES: Record<RoleKey, string> = {
  business_manager: 'Business Manager',
  area_business_manager: 'Area Business Manager',
  regional_business_manager: 'Regional Business Manager',
  zonal_business_manager: 'Zonal Business Manager',
  sales_manager: 'Sales Manager',
  general_manager: 'General Manager',
  vice_president: 'Vice President',
  director: 'Director',
  system_admin: 'System Admin',
  distribution_head: 'Distribution Head',
  accountant: 'Accountant',
};

/** Rank 1..8 for the sales hierarchy; 0 = outside the hierarchy (system_admin). */
export const ROLE_RANK: Record<RoleKey, number> = {
  business_manager: 1,
  area_business_manager: 2,
  regional_business_manager: 3,
  zonal_business_manager: 4,
  sales_manager: 5,
  general_manager: 6,
  vice_president: 7,
  director: 8,
  system_admin: 0,
  distribution_head: 0,
  accountant: 0,
};

export const PERMISSIONS = [
  'me:read',
  'roles:read',
  'territories:read',
  'territories:write',
  'users:read',
  'users:write',
  'masters:read',
  'masters:write',
  'imports:write',
  'field:read',
  'field:write',
  'approvals:decide',
  'reports:read',
  'settings:write',
  'audit:read',
  /** Stockists, primary/secondary sales and distribution views, company-wide (distribution_head). */
  'sales:read',
  /** Expenses and finance reports, company-wide (accountant). */
  'finance:read',
] as const;
export const Permission = z.enum(PERMISSIONS).meta({ id: 'Permission' });
export type Permission = z.infer<typeof Permission>;

const BASE: Permission[] = ['me:read', 'roles:read', 'territories:read', 'masters:read'];
const MANAGER: Permission[] = [
  ...BASE,
  'users:read',
  'masters:write',
  'field:read',
  'approvals:decide',
  'reports:read',
];
/** Default permissions per role (seeded into role_permissions; editable per company). */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  business_manager: [...BASE, 'masters:write', 'field:read', 'field:write', 'reports:read'],
  area_business_manager: MANAGER,
  regional_business_manager: MANAGER,
  zonal_business_manager: MANAGER,
  sales_manager: MANAGER,
  general_manager: MANAGER,
  vice_president: MANAGER,
  director: [...MANAGER, 'imports:write', 'settings:write', 'audit:read'],
  system_admin: [
    ...BASE,
    'territories:write',
    'users:read',
    'users:write',
    'masters:write',
    'imports:write',
    'settings:write',
    'audit:read',
  ],
  distribution_head: ['me:read', 'roles:read', 'territories:read', 'sales:read'],
  accountant: ['me:read', 'roles:read', 'territories:read', 'finance:read'],
};

export const Role = z
  .object({
    id: Id,
    key: RoleKey,
    name: z.string(),
    rank: z
      .int()
      .min(0)
      .max(8)
      .meta({
        description:
          '1..8 sales hierarchy; 0 = outside it (system_admin, distribution_head, accountant)',
      }),
    inHierarchy: z.boolean(),
    permissions: z.array(Permission),
  })
  .meta({ id: 'Role' });
export type Role = z.infer<typeof Role>;
export const RoleList = z.object({ items: z.array(Role) }).meta({ id: 'RoleList' });
