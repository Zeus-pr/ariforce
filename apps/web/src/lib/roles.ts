/**
 * The AriForce role ladder. Single source of truth for role names, order and labels in the web app.
 *
 * Sales hierarchy, lowest to highest, then the technical System Admin (outside the ladder).
 * Business Manager is the field level: check-in, DCR, tour plan. Every level above approves and sees
 * its team's data. System Admin sees only admin and configuration areas.
 */
import { HIERARCHY_ROLE_KEYS, ROLE_KEYS, type RoleKey } from '@ariforce/contracts';

/** Role values come straight from the contract enum (packages/contracts schemas/roles.ts). */
export const SALES_LADDER = HIERARCHY_ROLE_KEYS;
export type SalesRole = (typeof HIERARCHY_ROLE_KEYS)[number];
export type Role = RoleKey;
/**
 * Distribution Head and Accountant have no portal access: they are in no picker, nav, filter or
 * persona. The contract may still return them on a user; show NEUTRAL_ROLE_LABEL for those.
 */
export const RETIRED_ROLES: readonly Role[] = ['distribution_head', 'accountant'];
export const isPortalRole = (r: string): r is Role =>
  (ROLE_KEYS as readonly string[]).includes(r) && !RETIRED_ROLES.includes(r as Role);
/** Roles that can use the web portal (everything in pickers, nav and permission maps). */
export const ROLES: readonly Role[] = ROLE_KEYS.filter(isPortalRole);
export const NEUTRAL_ROLE_LABEL = 'Other role';

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
  distribution_head: NEUTRAL_ROLE_LABEL,
  accountant: NEUTRAL_ROLE_LABEL,
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
  distribution_head: 'Other',
  accountant: 'Other',
};

/** 1 = Business Manager ... 8 = Director. System Admin (and roles without portal access) have no sales level (0). */
export function roleLevel(role: Role): number {
  return (SALES_LADDER as readonly string[]).indexOf(role) + 1;
}

export const isFieldRole = (r: Role) => r === 'business_manager';
export const isApprover = (r: Role) => roleLevel(r) >= 2;
export const isSystemAdmin = (r: Role) => r === 'system_admin';

/** Label for any role string from the API; unknown or retired roles get a neutral label. */
export const roleLabel = (r: string | null | undefined) =>
  r && isPortalRole(r) ? ROLE_LABEL[r] : NEUTRAL_ROLE_LABEL;
