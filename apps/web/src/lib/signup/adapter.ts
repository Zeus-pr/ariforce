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
} from '@ariforce/contracts';
import type * as z from 'zod';
import { REAL, api, apiReady } from '@/lib/api';
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
      return status === 403 ? 'Your role does not have access to this portal.' : ROLE_RETIRED_MESSAGE;
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
  if (i.password.length < SIGNUP_PASSWORD_MIN)
    return f(`Use at least ${SIGNUP_PASSWORD_MIN} characters.`, 'password');
  if (i.password.length > 128) return f('Use at most 128 characters.', 'password');
  if (!SIGNUP_ROLES.includes(i.requestedRole as Role)) return f('Pick your role.', 'requestedRole');
  return SignupRequestCreate.safeParse(i).success
    ? null
    : new SignupError(messageFor(422), 'VALIDATION', undefined, 422);
}

/** 0-4 hint only (length 12/16, mixed case, digit + symbol); the server only enforces length. */
export function strength(p: string): { score: number; label: string } {
  if (p.length < SIGNUP_PASSWORD_MIN) return { score: p ? 1 : 0, label: p ? 'Too short' : '' };
  let s = 1;
  if (p.length >= 16) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return { score: s, label: ['', 'Fair', 'Good', 'Strong', 'Very strong'][s]! };
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

// ---------- mock store ----------
const KEY = 'af:mock-signups';
type Stored = SignupRequest & { passwordHash: string };

async function hash(p: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const SEED: Stored[] = (
  [
    [
      'Anita Ghosh',
      'anita.ghosh@example.test',
      '+91 90000 00011',
      'business_manager',
      '2026-10-24T05:30:00Z',
    ],
    [
      'Rakesh Mondal',
      'rakesh.mondal@example.test',
      null,
      'regional_business_manager',
      '2026-10-25T06:10:00Z',
    ],
    [
      'Sumana Paul',
      'sumana.paul@example.test',
      '+91 90000 00013',
      'business_manager',
      '2026-10-26T04:45:00Z',
    ],
    [
      'Arijit Das',
      'arijit.das@example.test',
      '+91 90000 00014',
      'area_business_manager',
      '2026-10-26T09:20:00Z',
    ],
  ] as const
).map(([name, email, phone, role, createdAt], i) => ({
  id: `00000000-0000-4000-8000-5eed0000000${i + 1}`,
  userId: `00000000-0000-4000-8000-5eed1000000${i + 1}`,
  name,
  email,
  phone,
  requestedRole: role,
  requestedTerritoryId: null,
  requestedManagerId: null,
  status: 'pending',
  approvedRole: null,
  decidedBy: null,
  decidedAt: null,
  reason: null,
  createdAt,
  passwordHash: '', // seeded: any password shows the pending message (demo only)
}));
function load(): Stored[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stored[];
  } catch {
    /* storage blocked */
  }
  return SEED.map((s) => ({ ...s }));
}
function save(rows: Stored[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* storage blocked */
  }
}
const delay = () => new Promise((r) => setTimeout(r, 150));
const strip = ({ passwordHash: _h, ...r }: Stored): SignupRequest => r;
function viewer(): { id: string; role: Role } | null {
  try {
    const s = JSON.parse(localStorage.getItem('af:mock-session') ?? 'null') as {
      userId?: string;
      role?: Role;
      previewRole?: Role;
    } | null;
    const role = s?.previewRole ?? s?.role;
    return s?.userId && role ? { id: s.userId, role } : null;
  } catch {
    return null;
  }
}
const uuid = () =>
  `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`;

const mockAdapter = {
  async submit(input: SignupInput): Promise<string> {
    await delay();
    const bad = validate(input);
    if (bad) throw bad;
    const rows = load();
    const email = input.email.trim().toLowerCase();
    if (rows.some((r) => r.email === email) || /@demo\.ariforce\.(test|in)$/.test(email))
      throw new SignupError(
        messageFor(409, AUTH_STATE_CODES.unavailable),
        AUTH_STATE_CODES.unavailable,
        undefined,
        409,
      );
    rows.unshift({
      id: uuid(),
      userId: uuid(),
      name: input.name.trim(),
      email,
      phone: input.phone?.trim() || null,
      requestedRole: input.requestedRole as Role,
      requestedTerritoryId: input.territoryId ?? null,
      requestedManagerId: input.managerId ?? null,
      status: 'pending',
      approvedRole: null,
      decidedBy: null,
      decidedAt: null,
      reason: null,
      createdAt: new Date().toISOString(),
      passwordHash: await hash(input.password),
    });
    save(rows);
    return 'Request received. You can sign in once an administrator approves it.';
  },
  /** Mock sign-in hook: the state of a request for this email (password checked when one was set). */
  async statusFor(email: string, password: string): Promise<SignupStatus | null> {
    const row = load().find((r) => r.email === email.trim().toLowerCase());
    if (!row) return null;
    if (row.passwordHash && row.passwordHash !== (await hash(password))) return null;
    return row.status;
  },
  async list(role: Role, status: SignupStatus): Promise<SignupRequest[]> {
    await delay();
    const me = viewer();
    return load()
      .filter(
        (r) =>
          r.status === status &&
          canDecide(role, r) &&
          r.userId !== me?.id &&
          (isSystemAdmin(role) || !r.requestedManagerId || r.requestedManagerId === me?.id),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(strip);
  },
  async approve(id: string, d: Decision): Promise<SignupRequest> {
    await delay();
    return decide(id, (row, me) => {
      if (!grantableRoles(me.role).includes(d.role as Role))
        throw new SignupError(messageFor(403), 'FORBIDDEN', undefined, 403);
      if (!takesManager(d.role as Role) && d.managerId)
        throw new SignupError('This role has no manager.', 'VALIDATION', undefined, 422);
      if (needsTerritory(d.role as Role) && !(d.territoryIds?.length ?? row.requestedTerritoryId))
        throw new SignupError('Pick at least one territory.', 'VALIDATION', undefined, 422);
      Object.assign(row, { status: 'approved', approvedRole: d.role });
    });
  },
  async reject(id: string, reason: string | null): Promise<SignupRequest> {
    await delay();
    return decide(id, (row) =>
      Object.assign(row, { status: 'rejected', reason: reason?.trim() || null }),
    );
  },
};
function decide(id: string, apply: (row: Stored, me: { id: string; role: Role }) => void) {
  const me = viewer();
  if (!me) throw new SignupError('Sign in again.', 'UNAUTHENTICATED', undefined, 401);
  const rows = load();
  const row = rows.find((r) => r.id === id);
  if (!row || !canDecide(me.role, row) || row.userId === me.id)
    throw new SignupError(messageFor(404), 'NOT_FOUND', undefined, 404);
  if (row.status !== 'pending') throw new SignupError(messageFor(409), 'CONFLICT', undefined, 409);
  apply(row, me);
  Object.assign(row, { decidedBy: me.id, decidedAt: new Date().toISOString() });
  save(rows);
  return strip(row);
}

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

const apiAdapter: typeof mockAdapter = {
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

export const signupAdapter = REAL ? apiAdapter : mockAdapter;
