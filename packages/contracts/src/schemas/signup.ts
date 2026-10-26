import * as z from 'zod';
import { Id, Timestamp } from './common';
import { HIERARCHY_ROLE_KEYS, FUNCTIONAL_ROLE_KEYS, RoleKey } from './roles';

/**
 * Self sign-up with approval (docs/RBAC.md "Sign-up requests"). The requested role is only a
 * request; nothing is granted until a system admin or a manager above that role approves.
 */
export const SIGNUP_ROLE_KEYS = [...HIERARCHY_ROLE_KEYS, ...FUNCTIONAL_ROLE_KEYS] as const;
export const SignupRoleKey = z.enum(SIGNUP_ROLE_KEYS).meta({ id: 'SignupRoleKey' });
/** Same minimum as the admin CLI. */
export const SIGNUP_PASSWORD_MIN = 12;

/** Error codes the sign-in / sign-up screens must handle. */
export const AUTH_STATE_CODES = {
  pending: 'ACCOUNT_PENDING_APPROVAL',
  rejected: 'ACCOUNT_REJECTED',
  unavailable: 'SIGNUP_UNAVAILABLE',
  rateLimited: 'RATE_LIMITED',
  captcha: 'CAPTCHA_FAILED',
} as const;

export const SignupRequestCreate = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.email().max(254),
    phone: z.string().trim().min(6).max(20).nullable().default(null),
    password: z.string().min(SIGNUP_PASSWORD_MIN).max(128),
    requestedRole: SignupRoleKey,
    territoryId: Id.nullable().default(null).meta({ description: 'Optional HQ/territory' }),
    managerId: Id.nullable().default(null).meta({ description: 'Optional requested manager' }),
    turnstileToken: z
      .string()
      .max(4096)
      .optional()
      .meta({ description: 'Required only when the server has TURNSTILE_SECRET set' }),
  })
  .meta({ id: 'SignupRequestCreate' });

export const SignupRequestAccepted = z
  .object({ status: z.literal('pending'), message: z.string() })
  .meta({ id: 'SignupRequestAccepted' });

export const SignupStatus = z
  .enum(['pending', 'approved', 'rejected'])
  .meta({ id: 'SignupStatus' });

export const SignupRequest = z
  .object({
    id: Id,
    userId: Id,
    name: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    requestedRole: RoleKey,
    requestedTerritoryId: Id.nullable(),
    requestedManagerId: Id.nullable(),
    status: SignupStatus,
    approvedRole: RoleKey.nullable(),
    decidedBy: Id.nullable(),
    decidedAt: Timestamp.nullable(),
    reason: z.string().nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'SignupRequest' });
export const SignupRequestList = z
  .object({ items: z.array(SignupRequest) })
  .meta({ id: 'SignupRequestList' });
export const SignupRequestQuery = z.object({
  status: SignupStatus.optional().default('pending'),
});

export const SignupApprove = z
  .object({
    role: SignupRoleKey.meta({
      description: 'May differ from the requested role; within your authority',
    }),
    territoryIds: z.array(Id).optional().meta({ description: 'Default: the requested territory' }),
    managerId: Id.nullable().optional().meta({
      description: 'Default: requested manager, else you (managers). Directors have none.',
    }),
  })
  .meta({ id: 'SignupApprove' });
export const SignupReject = z
  .object({ reason: z.string().trim().max(500).nullable().default(null) })
  .meta({ id: 'SignupReject' });

/** Public pick-lists for the sign-up form (GET /v1/auth/sign-up-options). No PII. */
export const SignupOptions = z
  .object({
    territories: z.array(z.object({ id: Id, name: z.string(), code: z.string() })),
    managers: z.array(
      z.object({
        id: Id,
        name: z.string(),
        role: RoleKey.meta({ description: 'Highest hierarchy role (ABM and above)' }),
      }),
    ),
  })
  .meta({ id: 'SignupOptions' });
export type SignupOptions = z.infer<typeof SignupOptions>;
