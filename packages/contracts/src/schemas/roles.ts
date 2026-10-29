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

/**
 * Retired roles (2026-10-27): no path may assign them any more (422 ROLE_RETIRED), they are hidden
 * from role lists, and holders cannot sign in or accept an invite. Rows, role rows and permission
 * seeds are kept so existing records still read. See docs/RBAC.md.
 */
export const RETIRED_ROLE_KEYS = [
  'distribution_head',
  'accountant',
] as const satisfies readonly RoleKey[];
export const isRetiredRole = (r: string) => (RETIRED_ROLE_KEYS as readonly string[]).includes(r);
/** Roles that can still be assigned (everything except RETIRED_ROLE_KEYS). */
export const ASSIGNABLE_ROLE_KEYS = ROLE_KEYS.filter((r) => !isRetiredRole(r)) as RoleKey[];

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
  /** Stockists list/get (everyone with masters:read, plus distribution_head). */
  'stockists:read',
  /** Products, divisions, product-HQ mappings (masters:read holders, distribution_head, accountant). */
  'products:read',
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
  /** Legacy (retired accountant role); no endpoint checks it since 0040. Use expenses:pay. */
  'finance:read',
  /** Own expense claims: create, edit while draft/rejected, submit, attach receipts (#52). */
  'expenses:write',
  /** Read own expense claims, plus the reporting line's for managers. */
  'expenses:read',
  /** Decide expense claims of the reporting line (manager chain, never your own). */
  'expenses:approve',
  /** Legacy (retired accountant role); no endpoint checks it since 0040. Use expenses:pay. */
  'finance:write',
  /**
   * Mark approved expense claims as paid and read approved/paid claims and expense reports
   * company-wide (director, system_admin). Replaces finance:write / finance:read (0040).
   */
  'expenses:pay',
  /** Own leave: balances, requests, calendar; managers also their reporting line's (#51). */
  'leave:read',
  /** Apply for and cancel your own leave (#51). */
  'leave:write',
  /** Decide, cancel and grant leave for the reporting line (manager chain, never your own). */
  'leave:approve',
  /** Edit product MRP/PTR/PTS (single and bulk) and read price history: system_admin only. */
  'products:prices',
  /** Read SFC (Standard Fare Chart) routes: own table (BM), reporting line (managers), company (director, system_admin). */
  'sfc:read',
  /** Edit SFC routes of the reporting line (ABM and above), company-wide for director and system_admin. */
  'sfc:write',
  /** Approve or reject submitted DCRs of the reporting line (ABM and up, system_admin; never your own). */
  'dcr:review',
] as const;
export const Permission = z.enum(PERMISSIONS).meta({ id: 'Permission' });
export type Permission = z.infer<typeof Permission>;

const BASE: Permission[] = [
  'me:read',
  'roles:read',
  'territories:read',
  'masters:read',
  'stockists:read',
  'products:read',
];

/** Read permission for a masters collection (path segment under /v1). */
export function masterReadPermission(segment: string): Permission {
  if (segment === 'territories') return 'territories:read';
  if (segment === 'stockists') return 'stockists:read';
  if (['products', 'divisions', 'product-hq-mappings'].includes(segment)) return 'products:read';
  return 'masters:read';
}
/**
 * Masters write (doctors, chemists, stockists, products, divisions, territories, work types,
 * HQ mappings, imports): RBM and above + system_admin. ABM and BM are read-only on masters.
 */
export const MASTERS_WRITE: Permission[] = ['masters:write', 'territories:write', 'imports:write'];
/** Lowest hierarchy rank with masters write (RBM). */
export const MASTERS_WRITE_MIN_RANK = 3;
/** ABM: manager, read-only on masters. */
/** Own expense claims (everyone in the sales hierarchy). */
const EXPENSES_OWN: Permission[] = ['expenses:read', 'expenses:write'];
/** Own leave (everyone in the sales hierarchy). */
const LEAVE_OWN: Permission[] = ['leave:read', 'leave:write'];
/** ABM and up (incl. director): managers also file their own DCRs (field:write, 0044). */
const MANAGER: Permission[] = [
  ...BASE,
  'users:read',
  'field:read',
  'field:write',
  'approvals:decide',
  'reports:read',
  ...EXPENSES_OWN,
  'expenses:approve',
  ...LEAVE_OWN,
  'leave:approve',
  'sfc:read',
  'sfc:write',
  'dcr:review',
];
/** RBM and above. */
const SENIOR: Permission[] = [...MANAGER, ...MASTERS_WRITE];
/** Default permissions per role (seeded into roles.permissions; editable per company). */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  business_manager: [
    ...BASE,
    'field:read',
    'field:write',
    'reports:read',
    ...EXPENSES_OWN,
    ...LEAVE_OWN,
    'sfc:read',
  ],
  area_business_manager: MANAGER,
  regional_business_manager: SENIOR,
  zonal_business_manager: SENIOR,
  sales_manager: SENIOR,
  general_manager: SENIOR,
  vice_president: SENIOR,
  director: [...SENIOR, 'settings:write', 'audit:read', 'expenses:pay'],
  system_admin: [
    ...BASE,
    ...MASTERS_WRITE,
    'users:read',
    'users:write',
    'settings:write',
    'audit:read',
    'products:prices',
    'sfc:read',
    'sfc:write',
    'expenses:pay',
    'dcr:review',
  ],
  // Accepted by lead: read-only, company-wide; no doctors/chemists; never masters write.
  distribution_head: [
    'me:read',
    'roles:read',
    'territories:read',
    'stockists:read',
    'products:read',
    'sales:read',
  ],
  accountant: [
    'me:read',
    'roles:read',
    'territories:read',
    'products:read',
    'finance:read',
    'finance:write',
  ],
};

export const Role = z
  .object({
    id: Id,
    key: RoleKey,
    name: z.string(),
    rank: z.int().min(0).max(8).meta({
      description:
        '1..8 sales hierarchy; 0 = outside it (system_admin, distribution_head, accountant)',
    }),
    inHierarchy: z.boolean(),
    permissions: z.array(Permission),
  })
  .meta({ id: 'Role' });
export type Role = z.infer<typeof Role>;
export const RoleList = z.object({ items: z.array(Role) }).meta({ id: 'RoleList' });
