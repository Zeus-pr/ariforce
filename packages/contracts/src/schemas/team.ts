import * as z from 'zod';
import { Id, Timestamp } from './common';
import { NewPassword, PASSWORD_MIN } from './password';
import { NON_HIERARCHY_ROLE_KEYS, ROLE_RANK, RoleKey } from './roles';

/**
 * Team hierarchy and manager-side employee management (docs/RBAC.md "Team and employees").
 * No payroll/HR data (PAN, bank, CTC, nominee) is ever part of these schemas.
 */

/** Highest hierarchy rank among a user's roles (0 = none / outside the hierarchy). */
export function hierarchyRank(roles: readonly RoleKey[]): number {
  return Math.max(0, ...roles.map((r) => ROLE_RANK[r]));
}
/** Roles that may be granted through the manager flow: hierarchy roles strictly below `rank`. */
export function assignableRoles(rank: number): RoleKey[] {
  return (Object.keys(ROLE_RANK) as RoleKey[]).filter(
    (r) => ROLE_RANK[r] > 0 && ROLE_RANK[r] < rank,
  );
}
export const isHierarchyRole = (r: RoleKey) =>
  !(NON_HIERARCHY_ROLE_KEYS as readonly string[]).includes(r);
/** ABM (rank 2) and above may add/edit employees below them. */
export const MIN_MANAGER_RANK = 2;

export const UserStatus = z.enum(['invited', 'active', 'suspended']).meta({ id: 'UserStatus' });

export const TeamTerritory = z
  .object({
    id: Id,
    name: z.string(),
    code: z.string(),
    level: z.string(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
  })
  .meta({ id: 'TeamTerritory' });

export const TeamNode = z
  .object({
    id: Id,
    name: z.string(),
    role: RoleKey.nullable().meta({ description: 'Highest role; null if none assigned' }),
    roles: z.array(RoleKey),
    designation: z.string().nullable().meta({ description: 'Free-text HR title, not a role' }),
    employeeCode: z.string().nullable(),
    joinedOn: z.iso.date().nullable().meta({ description: 'Date of joining' }),
    phone: z.string().nullable(),
    email: z.string(),
    status: UserStatus,
    managerId: Id.nullable(),
    depth: z.int().meta({ description: '0 = the caller (root); unassigned users have depth -1' }),
    territories: z.array(TeamTerritory),
    directReportCount: z.int(),
    version: z.int(),
  })
  .meta({ id: 'TeamNode' });
export type TeamNode = z.infer<typeof TeamNode>;

export const TeamTree = z
  .object({
    rootId: Id,
    nodes: z.array(TeamNode).meta({
      description:
        'The caller and their reporting-line subtree, depth-first; build the tree from managerId',
    }),
    unassigned: z.array(TeamNode).meta({
      description:
        'Hierarchy users with no manager (and not the top), whose territory lies in the caller scope; managers (rank >= 2) only',
    }),
  })
  .meta({ id: 'TeamTree' });
export type TeamTree = z.infer<typeof TeamTree>;

const Phone = z.string().trim().min(6).max(20);
export const EmployeeCreate = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.email(),
    phone: Phone.nullable().default(null),
    employeeCode: z.string().trim().min(1).max(50).nullable().default(null),
    designation: z.string().trim().max(100).nullable().default(null),
    joinedOn: z.iso.date().nullable().default(null),
    role: RoleKey.meta({
      description:
        "Must be a hierarchy role strictly below the caller's; a system admin (users:write) may grant any role",
    }),
    territoryIds: z.array(Id).default([]).meta({
      description:
        "Within the caller's territory subtree (system admin: any territory in the company). Hierarchy roles need at least one; functional roles may send none",
    }),
    managerId: Id.nullable()
      .default(null)
      .meta({ description: 'Default = caller; must be the caller or in their subtree' }),
  })
  .meta({ id: 'EmployeeCreate' });

export const EmployeeUpdate = z
  .object({
    version: z.int(),
    name: z.string().trim().min(1).max(200).optional(),
    email: z.email().optional().meta({
      description:
        'System admin only. 409 EMAIL_LOCKED_HAS_LOGIN once the person has a login; 409 EMAIL_TAKEN if used. A pending invite is re-sent to the new address',
    }),
    employeeCode: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .nullable()
      .optional()
      .meta({ description: 'System admin only. 409 EMPLOYEE_CODE_TAKEN if used' }),
    phone: Phone.nullable().optional(),
    designation: z.string().trim().max(100).nullable().optional(),
    joinedOn: z.iso.date().nullable().optional(),
    role: RoleKey.optional(),
    territoryIds: z.array(Id).optional().meta({
      description:
        'Replaces all territories (first = primary). Hierarchy roles need at least one; functional roles may send []',
    }),
    managerId: Id.nullable().optional().meta({
      description:
        'Move within the subtree. null (system admin only) clears it; directors and functional roles never have one',
    }),
    status: z.enum(['active', 'suspended']).optional().meta({
      description: 'suspended = deactivate (sign-in blocked); active = reactivate',
    }),
  })
  .meta({ id: 'EmployeeUpdate' });

export const ManagerAssign = z
  .object({ managerId: Id.meta({ description: 'The caller or someone in their subtree' }) })
  .meta({ id: 'ManagerAssign' });

export const Invite = z
  .object({
    id: Id,
    userId: Id,
    expiresAt: Timestamp,
    inviteUrl: z.string().nullable().meta({
      description:
        'Only returned when the server runs with INVITE_RETURN_LINK=true outside production (dev/test); otherwise null and delivered by the mailer',
    }),
  })
  .meta({ id: 'Invite' });

export const EmployeeCreated = z
  .object({ employee: TeamNode, invite: Invite })
  .meta({ id: 'EmployeeCreated' });

/** Minimum password length when accepting an invite (#26). */
export const INVITE_PASSWORD_MIN = PASSWORD_MIN;
export const InviteAccept = z
  .object({
    token: z.string().min(20).max(200),
    password: NewPassword,
  })
  .meta({ id: 'InviteAccept' });
/** Distinct invite-accept failures (#26): unknown or superseded token, already redeemed, expired. */
export const INVITE_ERROR_CODES = ['INVITE_INVALID', 'INVITE_USED', 'INVITE_EXPIRED'] as const;

/** Max employees per bulk invite request (#26). */
export const INVITE_BULK_MAX = 200;
export const EmployeeInviteBulk = z
  .object({ employees: z.array(EmployeeCreate).min(1).max(INVITE_BULK_MAX) })
  .meta({ id: 'EmployeeInviteBulk' });
export const InviteBulkItemResult = z
  .object({
    index: z.int().min(0).meta({ description: 'Position in the request array' }),
    email: z.string().nullable().meta({ description: 'As sent (null if missing)' }),
    status: z.enum(['invited', 'skipped', 'failed']).meta({
      description:
        'invited = employee created + invite issued; skipped = email/employee code already exists or repeated in this batch; failed = validation or authorization error for this row',
    }),
    code: z.string().nullable().meta({
      description:
        'null when invited; skipped: CONFLICT | DUPLICATE_IN_BATCH; failed: VALIDATION | FORBIDDEN | INTERNAL',
    }),
    message: z.string().nullable(),
    employeeId: Id.nullable(),
    inviteId: Id.nullable(),
    inviteUrl: z.string().nullable().meta({
      description: 'Only when INVITE_RETURN_LINK=true and not production; otherwise null',
    }),
  })
  .meta({ id: 'InviteBulkItemResult' });
export const InviteBulkResponse = z
  .object({
    results: z.array(InviteBulkItemResult),
    summary: z.object({ invited: z.int(), skipped: z.int(), failed: z.int() }),
  })
  .meta({ id: 'InviteBulkResponse' });
export const InviteAccepted = z
  .object({ userId: Id, email: z.string() })
  .meta({ id: 'InviteAccepted' });
