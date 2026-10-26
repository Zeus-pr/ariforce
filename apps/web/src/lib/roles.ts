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
export const ROLES: readonly Role[] = ROLE_KEYS;

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
