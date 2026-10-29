import type { RoleKey } from '@ariforce/contracts';

/**
 * Role names and levels, mirrored from apps/web/src/lib/roles.ts. `satisfies Record<RoleKey, …>`
 * makes tsc fail here when the contract adds or renames a role. Type-only import: the contracts
 * package (and zod) never enter the app bundle.
 */
const ROLE_LABEL = {
  business_manager: 'Business Manager',
  area_business_manager: 'Area Business Manager',
  regional_business_manager: 'Regional Business Manager',
  zonal_business_manager: 'Zonal Business Manager',
  sales_manager: 'Sales Manager',
  general_manager: 'General Manager',
  vice_president: 'Vice President',
  director: 'Director',
  system_admin: 'System Admin',
  distribution_head: 'Other role',
  accountant: 'Other role',
} satisfies Record<RoleKey, string>;

/** Sales level: 1 = Business Manager … 8 = Director; 0 = outside the ladder. */
const ROLE_LEVEL = {
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
} satisfies Record<RoleKey, number>;

const isRoleKey = (r: string): r is RoleKey => Object.hasOwn(ROLE_LEVEL, r);
const level = (r: string) => (isRoleKey(r) ? ROLE_LEVEL[r] : 0);

/** Highest role on the user (by sales level), else their first known role. */
export function primaryRole(roles: readonly string[]): RoleKey | null {
  const known = roles.filter(isRoleKey);
  if (known.length === 0) return null;
  return known.reduce((best, r) => (level(r) > level(best) ? r : best));
}

export function roleLabel(roles: readonly string[]) {
  const r = primaryRole(roles);
  return r ? ROLE_LABEL[r] : 'Other role';
}

/** Same rule as the website's isApprover: level 2 (ABM) and above approve their team's work. */
export const isApprover = (roles: readonly string[]) => roles.some((r) => level(r) >= 2);

/**
 * Who may change master data (doctors, chemists, stockists): same rule as the website's
 * canWriteMasters (apps/web/src/lib/permissions.ts, docs/PERMISSIONS.md). Regional Business
 * Manager and above (ZBM, SM, GM, VP, Director) and System Admin add, edit and remove; Area
 * Business Manager and Business Manager are read-only. The API also returns 403 on their writes.
 */
export const canWriteMasters = (roles: readonly string[]) =>
  roles.some((r) => r === 'system_admin' || level(r) >= ROLE_LEVEL.regional_business_manager);
