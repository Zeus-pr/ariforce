/**
 * The AriForce role ladder. Single source of truth for role names, order and labels in the web app.
 *
 * Sales hierarchy, lowest to highest, then the technical System Admin (outside the ladder).
 * Business Manager is the field level: check-in, DCR, tour plan. Every level above approves and sees
 * its team's data. System Admin sees only admin and configuration areas.
 */
export const SALES_LADDER = [
  'business_manager',
  'area_business_manager',
  'regional_business_manager',
  'zonal_business_manager',
  'sales_manager',
  'general_manager',
  'vice_president',
  'director',
] as const;

export type SalesRole = (typeof SALES_LADDER)[number];
export type Role = SalesRole | 'system_admin';

export const ROLES: readonly Role[] = [...SALES_LADDER, 'system_admin'];

export const ROLE_LABEL: Record<Role, string> = {
  business_manager: 'Business Manager',
  area_business_manager: 'Area Business Manager',
  regional_business_manager: 'Regional Business Manager',
  zonal_business_manager: 'Zonal Business Manager',
  sales_manager: 'Sales Manager',
  general_manager: 'General Manager',
  vice_president: 'Vice President',
  director: 'Director',
  system_admin: 'System Admin',
};

export const ROLE_SHORT: Record<Role, string> = {
  business_manager: 'BM',
  area_business_manager: 'ABM',
  regional_business_manager: 'RBM',
  zonal_business_manager: 'ZBM',
  sales_manager: 'SM',
  general_manager: 'GM',
  vice_president: 'VP',
  director: 'Director',
  system_admin: 'Admin',
};

/** 1 = Business Manager ... 8 = Director. System Admin has no sales level (0). */
export function roleLevel(role: Role): number {
  return role === 'system_admin' ? 0 : SALES_LADDER.indexOf(role) + 1;
}

export const isFieldRole = (r: Role) => r === 'business_manager';
export const isApprover = (r: Role) => roleLevel(r) >= 2;
export const isSystemAdmin = (r: Role) => r === 'system_admin';

/**
 * TEMPORARY mapping to the contract's `RoleKey` enum (packages/contracts, PR #33), which still has the
 * older six values. Swap this table when the Architect updates the enum; nothing else should change.
 */
export const ROLE_TO_CONTRACT_ROLE_KEY = {
  business_manager: 'rep',
  area_business_manager: 'area_manager',
  regional_business_manager: 'regional_manager',
  zonal_business_manager: 'zonal_manager',
  sales_manager: 'national_head',
  general_manager: 'national_head',
  vice_president: 'national_head',
  director: 'national_head',
  system_admin: 'admin',
} as const satisfies Record<Role, string>;
