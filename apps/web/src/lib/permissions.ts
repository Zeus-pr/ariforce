/**
 * ONE place for "who may change master data" (docs/PERMISSIONS.md).
 * Owner rule: Regional Business Manager and above (ZBM, SM, GM, VP, Director) and System Admin
 * read AND write masters (add, edit, import, remove). Area Business Manager and Business Manager
 * are read-only. The API returns 403 on writes for ABM/BM (Architect, in progress on their side).
 */
import { DEFAULT_ROLE_PERMISSIONS } from '@ariforce/contracts';
import { ROLES, isSystemAdmin, roleLevel, type Role } from './roles';

export const MASTER_KINDS = ['doctors', 'chemists', 'stockists'] as const;

export function canWriteMasters(role: Role): boolean {
  return isSystemAdmin(role) || roleLevel(role) >= roleLevel('regional_business_manager');
}

export const MASTER_WRITERS: Role[] = ROLES.filter(canWriteMasters);

/** Write-only routes and who may open them (used by the route guard and the pre-paint script). */
export const WRITE_ROUTES: { href: string; roles: Role[] }[] = MASTER_KINDS.map((k) => ({
  href: `/${k}/import`,
  roles: MASTER_WRITERS,
}));

/** Who reviews sign-up requests: System Admin, and managers (ABM and above) for roles below them. */
export const canReviewSignups = (role: Role) =>
  isSystemAdmin(role) || roleLevel(role) >= roleLevel('area_business_manager');

/**
 * Who may mark an approved expense claim paid: the `expenses:pay` permission (API migration 0040:
 * Director and System Admin). Read from the contract's role -> permission map, with the role list
 * as a fallback in case the map lacks it. Pass the /v1/me permissions when you have them.
 */
export const EXPENSE_PAYERS: Role[] = ['director', 'system_admin'];
export const canPayExpenses = (role: Role, permissions?: readonly string[]) =>
  permissions
    ? permissions.includes('expenses:pay')
    : (DEFAULT_ROLE_PERMISSIONS[role] ?? []).includes('expenses:pay') ||
      EXPENSE_PAYERS.includes(role);

/**
 * Who may edit product prices and the product image on the Product prices page: the
 * `products:prices` permission (System Admin by default). Same map the page's API checks.
 */
export const canEditProductPrices = (role: Role, permissions?: readonly string[]) =>
  (permissions ?? DEFAULT_ROLE_PERMISSIONS[role] ?? []).includes('products:prices');
