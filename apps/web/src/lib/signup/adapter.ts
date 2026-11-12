/**
 * Sign-up requests, built on the Architect's contract (feat/signup-requests c067e17, docs/SIGNUP.md):
 *   POST /v1/auth/sign-up-request (public)        SignupRequestCreate -> 202 SignupRequestAccepted
 *   GET  /v1/signup-requests?status=...           -> { items: SignupRequest[] }
 *   POST /v1/signup-requests/{id}/approve         SignupApprove { role, territoryIds?, managerId? }
 *   POST /v1/signup-requests/{id}/reject          SignupReject { reason }
 * Real mode calls the API through the typed client. Mock mode keeps requests in this browser's
 * localStorage (so they survive reloads and sign-in/out while you try the flow), validates with the
 * same zod schemas and returns the same codes as the contract's MSW handlers. Passwords are never
 * stored in plaintext: the mock keeps a SHA-256 hash only.
 */
import { ROLE_RETIRED_MESSAGE, TERRITORY_LEVEL_MESSAGE } from '@/lib/assign-errors';
import { authLimitMessage, SUSPENDED_MESSAGE } from '@/lib/auth-errors';
import {
  AUTH_STATE_CODES,
  ROLE_RANK,
  SIGNUP_PASSWORD_MIN,
  SIGNUP_ROLE_KEYS,
  SignupApprove,
  SignupRequestCreate,
  assignableRoles,
  isHierarchyRole,
  passwordAccepted,
  passwordRuleMessage,
} from '@ariforce/contracts';
import type * as z from 'zod';
import { api, apiReady } from '@/lib/api';
import { isPortalRole, isSystemAdmin, type Role } from '@/lib/roles';

export type SignupInput = z.input<typeof SignupRequestCreate>;
export type SignupStatus = 'pending' | 'approved' | 'rejected';
export type SignupRequest = {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  requestedRole: Role;
  requestedTerritoryId: string | null;
  requestedManagerId: string | null;
  status: SignupStatus;
  approvedRole: Role | null;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  createdAt: string;
};
export type Decision = z.input<typeof SignupApprove>;
export type SignupOptions = {
  territories: { id: string; name: string; code: string }[];
  managers: { id: string; name: string; role: Role }[];
};

/**
 * Public GET /v1/auth/sign-up-options (both modes; MSW answers in mock). Any failure (429, 503,
 * network) returns null so the form hides the optional pickers instead of blocking.
 */
export async function signupOptions(signal?: AbortSignal): Promise<SignupOptions | null> {
  try {
    await apiReady();
    const r = await api.GET('/v1/auth/sign-up-options', { signal });
    return (r.data as SignupOptions | undefined) ?? null;
  } catch {
    return null;
  }
}
type Field = 'name' | 'email' | 'phone' | 'password' | 'requestedRole';

export { SIGNUP_PASSWORD_MIN };
export const SIGNUP_ROLES = (SIGNUP_ROLE_KEYS as readonly Role[]).filter(isPortalRole);

export class SignupError extends Error {
  constructor(
    message: string,
    public code?: string,
    public field?: Field,
    public status?: number,
  ) {
    super(message);
  }
}

/** Every code in docs/SIGNUP.md and API-CONVENTIONS "Sign-up and account-state codes", in plain words. */
export function messageFor(status: number, code?: string, serverMessage?: string): string {
  switch (code) {
    case AUTH_STATE_CODES.unavailable:
      // Deliberately generic on the server; show it as is.
      return (
        serverMessage ??
        'We could not create an account with these details. If you already have an account, sign in or contact your administrator.'
      );
    case AUTH_STATE_CODES.rateLimited:
      return 'Too many attempts, try again in a minute.';
    case AUTH_STATE_CODES.captcha:
      return 'The security check failed. Reload the page and try again.';
    case 'SIGNUP_DISABLED':
      return 'Account requests are switched off right now. Ask your administrator to add you.';
    case AUTH_STATE_CODES.pending:
      return 'This account is still awaiting approval.';
    case AUTH_STATE_CODES.rejected:
      return 'This sign-up request was not approved.';
    case AUTH_STATE_CODES.suspended:
      return SUSPENDED_MESSAGE;
    case 'ROLE_RETIRED':
      return status === 403
        ? 'Your role does not have access to this portal.'
        : ROLE_RETIRED_MESSAGE;
    case 'TERRITORY_LEVEL_INVALID':
      return TERRITORY_LEVEL_MESSAGE;
  }
  if (status === 422) return 'Some details are not valid. Check the fields and try again.';
  if (status === 403) return 'That is outside what you can approve, or it is your own request.';
  if (status === 404) return 'This request is no longer visible to you. Refresh the list.';
  if (status === 409) return 'This request was already decided. Refresh the list.';
  if (status === 429) return 'Too many attempts, try again in a minute.';
  if (status === 503) return 'Account requests are switched off right now.';
  return serverMessage ?? 'Something went wrong. Try again.';
}

/** Client checks matching SignupRequestCreate, with friendly per-field messages. */
export function validate(i: SignupInput): SignupError | null {
  const f = (m: string, field: Field) => new SignupError(m, 'VALIDATION', field, 422);
  if (!i.name.trim()) return f('Enter your full name.', 'name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email.trim()))
    return f('Enter a valid work email.', 'email');
  const phone = i.phone?.trim() ?? '';
  if (phone && (phone.length < 6 || phone.length > 20 || !/^\+?[0-9 ()-]+$/.test(phone)))
    return f('Enter a valid phone number, or leave it empty.', 'phone');
  if (!passwordAccepted(i.password))
    return f(passwordRuleMessage(i.password) ?? 'Choose a stronger password.', 'password');
  if (!SIGNUP_ROLES.includes(i.requestedRole as Role)) return f('Pick your role.', 'requestedRole');
  return SignupRequestCreate.safeParse(i).success
    ? null
    : new SignupError(messageFor(422), 'VALIDATION', undefined, 422);
}

// ---------- who reviews what (one helper; route guard uses canReviewSignups in lib/permissions) ----------
const rank = (r: Role) => ROLE_RANK[r];
/** Roles the viewer may grant: System Admin any sign-up role; ABM+ hierarchy roles below their own. */
export function grantableRoles(viewer: Role): Role[] {
  if (isSystemAdmin(viewer)) return [...SIGNUP_ROLES];
  return assignableRoles(rank(viewer)) as Role[];
}
/** Rows the viewer can decide (mirrors the mock; the API also checks the subtree). */
export function canDecide(viewer: Role, r: Pick<SignupRequest, 'requestedRole'>): boolean {
  if (isSystemAdmin(viewer)) return true;
  const rr = rank(r.requestedRole);
  return isHierarchyRole(r.requestedRole) && rr > 0 && rr < rank(viewer);
}
/** Director takes no manager; hierarchy roles need at least one territory. */
export const takesManager = (role: Role) => isHierarchyRole(role) && role !== 'director';
export const needsTerritory = (role: Role) => isHierarchyRole(role);

export type SignupAdapter = {
  submit(input: SignupInput): Promise<string>;
  statusFor(email: string, password: string): Promise<SignupStatus | null>;
  list(role: Role, status: SignupStatus): Promise<SignupRequest[]>;
  approve(id: string, d: Decision): Promise<SignupRequest>;
  reject(id: string, reason: string | null): Promise<SignupRequest>;
};

// ---------- real ----------
function fail(error: unknown, response: Response): never {
  const e = (error ?? {}) as { error?: { code?: string; message?: string } };
  const code = e.error?.code;
  throw new SignupError(
    authLimitMessage({ response, error }) ?? messageFor(response.status, code, e.error?.message),
    code,
    undefined,
    response.status,
  );
}
const network = () =>
  new SignupError('Could not reach the server. Check your connection.', 'NETWORK');

const apiAdapter: SignupAdapter = {
  async submit(input) {
    const bad = validate(input);
    if (bad) throw bad;
    const body = SignupRequestCreate.parse({
      ...input,
      email: input.email.trim().toLowerCase(),
      phone: input.phone?.trim() || null,
    });
    const r = await api.POST('/v1/auth/sign-up-request', { body }).catch(() => {
      throw network();
    });
    if (!r.data) fail(r.error, r.response);
    return r.data.message;
  },
  async statusFor() {
    return null; // real mode: the sign-in response carries the code
  },
  async list(_role, status) {
    await apiReady();
    const r = await api.GET('/v1/signup-requests', { params: { query: { status } } }).catch(() => {
      throw network();
    });
    if (!r.data) fail(r.error, r.response);
    return r.data.items as SignupRequest[];
  },
  async approve(id, d) {
    const r = await api
      .POST('/v1/signup-requests/{id}/approve', { params: { path: { id } }, body: d as never })
      .catch(() => {
        throw network();
      });
    if (!r.data) fail(r.error, r.response);
    return r.data as SignupRequest;
  },
  async reject(id, reason) {
    const r = await api
      .POST('/v1/signup-requests/{id}/reject', {
        params: { path: { id } },
        body: { reason: reason?.trim() || null },
      })
      .catch(() => {
        throw network();
      });
    if (!r.data) fail(r.error, r.response);
    return r.data as SignupRequest;
  },
};

export const signupAdapter = apiAdapter;
