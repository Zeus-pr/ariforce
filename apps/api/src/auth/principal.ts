import type { Permission, RoleKey } from '@ariforce/contracts';

/** Authenticated tenant user, resolved once per request by SessionGuard. */
export interface Principal {
  authUserId: string;
  sessionId: string;
  userId: string;
  companyId: string;
  roles: RoleKey[];
  permissions: Permission[];
  territoryIds: string[];
  /**
   * Territory paths the user may see (subtree prefix match): territories of the user and of everyone
   * below them in the reporting line (users.manager_id). null = whole company.
   */
  scopePaths: string[] | null;
  /** The user plus everyone below them in the reporting line. null = whole company (director). */
  teamUserIds: string[] | null;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

/** Sees the whole company (top of the sales hierarchy). */
export const COMPANY_WIDE_ROLES: RoleKey[] = ['director'];
/**
 * Technical admin outside the hierarchy: company-wide masters/users/settings, no reporting line.
 * Field data (check-ins, DCRs, reports) is gated by field:read / reports:read, which it lacks by default.
 */
export const MASTERS_WIDE_ROLES: RoleKey[] = ['system_admin'];
