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
  /** Territory paths the user may see (subtree prefix match). null = whole company. */
  scopePaths: string[] | null;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

/** Roles that see the whole company regardless of territory assignment. */
export const COMPANY_WIDE_ROLES: RoleKey[] = ['admin', 'national_head'];
