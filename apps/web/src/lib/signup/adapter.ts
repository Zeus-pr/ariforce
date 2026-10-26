/**
 * Sign-up requests. ASSUMED CONTRACT (CONTRACT-GAPS #23): the Architect's endpoints are not in
 * packages/contracts yet, so real mode calls the shapes below with plain fetch and mock mode keeps
 * requests in this browser's localStorage (password stored only as a SHA-256 hash, never plaintext).
 *
 *   POST /v1/auth/sign-up-request            (public)  SignUpInput -> 202 { id, status: 'pending' }
 *                                                       409 { error: { code: 'EMAIL_TAKEN' } }
 *   GET  /v1/public/hqs                      (public)  { items: Hq[] }
 *   GET  /v1/sign-up-requests?status=pending&q&cursor&limit -> { items: SignUpRequest[], nextCursor, total }
 *   POST /v1/sign-up-requests/{id}/approve   { role, hqId, managerId } -> SignUpRequest
 *   POST /v1/sign-up-requests/{id}/reject    { reason? }               -> SignUpRequest
 *   POST /v1/auth/sign-in/email for a pending identity -> 403 { error: { code: 'ACCOUNT_PENDING' } }
 *                                           (rejected -> 403 { error: { code: 'ACCOUNT_REJECTED' } })
 */
import { API_URL, REAL } from '@/lib/api';
import { canSee } from '@/lib/nav';
import { roleLevel, ROLES, isSystemAdmin, type Role } from '@/lib/roles';
import type { Hq, Page } from '@/lib/team-adapter/types';

export type SignUpStatus = 'pending' | 'approved' | 'rejected';
export type SignUpInput = {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: Role;
  hqId: string | null;
};
export type SignUpRequest = Omit<SignUpInput, 'password'> & {
  id: string;
  status: SignUpStatus;
  createdAt: string;
  reason: string | null;
};
export type Decision = { role: Role; hqId: string | null; managerId: string | null };

export class SignUpError extends Error {
  constructor(
    message: string,
    public field?: keyof SignUpInput,
    public status?: number,
  ) {
    super(message);
  }
}

/** Roles a reviewer may approve: System Admin any; a manager only roles below their own level. */
export function reviewableRoles(viewer: Role): Role[] {
  if (isSystemAdmin(viewer)) return [...ROLES];
  const lvl = roleLevel(viewer);
  return ROLES.filter((r) => roleLevel(r) > 0 && roleLevel(r) < lvl);
}

// ---------- validation shared by both modes ----------
export function validate(i: SignUpInput): SignUpError | null {
  if (i.name.trim().length < 2) return new SignUpError('Enter your full name.', 'name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email.trim()))
    return new SignUpError('Enter a valid work email.', 'email');
  if (!/^\+?[0-9][0-9 -]{8,15}$/.test(i.phone.trim()))
    return new SignUpError('Enter a 10-digit mobile number.', 'phone');
  if (i.password.length < 8) return new SignUpError('Use at least 8 characters.', 'password');
  if (!ROLES.includes(i.role)) return new SignUpError('Pick your role.', 'role');
  return null;
}

/** 0-4: length, mixed case, digit, symbol. Only a hint; the server decides. */
export function strength(p: string): { score: number; label: string } {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return { score: s, label: ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][s]! };
}

// ---------- mock ----------
const KEY = 'af:mock-signups';
type Stored = SignUpRequest & { passwordHash: string };

async function hash(p: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const SEED: Stored[] = [
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
    '+91 90000 00012',
    'distribution_head',
    '2026-10-25T06:10:00Z',
  ],
  [
    'Sumana Paul',
    'sumana.paul@example.test',
    '+91 90000 00013',
    'accountant',
    '2026-10-26T04:45:00Z',
  ],
  [
    'Arijit Das',
    'arijit.das@example.test',
    '+91 90000 00014',
    'area_business_manager',
    '2026-10-26T09:20:00Z',
  ],
].map(([name, email, phone, role, createdAt], i) => ({
  id: `signup-seed-${i + 1}`,
  name: name!,
  email: email!,
  phone: phone!,
  role: role as Role,
  hqId: null,
  status: 'pending' as const,
  createdAt: createdAt!,
  reason: null,
  // No hash: any password shows "Awaiting approval" for these seeded emails (demo only).
  passwordHash: '',
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
const strip = ({ passwordHash: _h, ...r }: Stored): SignUpRequest => r;

function currentRole(): Role | null {
  try {
    const s = JSON.parse(localStorage.getItem('af:mock-session') ?? 'null') as {
      role?: Role;
      previewRole?: Role;
    } | null;
    return s?.previewRole ?? s?.role ?? null;
  } catch {
    return null;
  }
}

const mockAdapter = {
  async submit(input: SignUpInput): Promise<{ id: string; status: SignUpStatus }> {
    await delay();
    const bad = validate(input);
    if (bad) throw bad;
    const rows = load();
    const email = input.email.trim().toLowerCase();
    if (rows.some((r) => r.email === email && r.status !== 'rejected'))
      throw new SignUpError('A request for this email already exists.', 'email', 409);
    const row: Stored = {
      id: `signup-${Date.now().toString(36)}`,
      name: input.name.trim(),
      email,
      phone: input.phone.trim(),
      role: input.role,
      hqId: input.hqId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      reason: null,
      passwordHash: await hash(input.password),
    };
    save([row, ...rows]);
    return { id: row.id, status: 'pending' };
  },
  async publicHqs(): Promise<Hq[]> {
    const { teamAdapter } = await import('@/lib/team-adapter/adapter');
    return 'allHqs' in teamAdapter ? (teamAdapter as { allHqs: () => Hq[] }).allHqs() : [];
  },
  /** Mock sign-in hook: the status of a request matching email (and password, when one was set). */
  async statusFor(email: string, password: string): Promise<SignUpStatus | null> {
    const e = email.trim().toLowerCase();
    const row = load().find((r) => r.email === e);
    if (!row) return null;
    if (row.passwordHash && row.passwordHash !== (await hash(password))) return null;
    return row.status;
  },
  async list(
    viewer: Role,
    { q = '', cursor, limit = 20 }: { q?: string; cursor?: string | null; limit?: number },
  ): Promise<Page<SignUpRequest>> {
    await delay();
    const allowed = new Set(reviewableRoles(viewer));
    const term = q.trim().toLowerCase();
    const all = load()
      .filter((r) => r.status === 'pending' && allowed.has(r.role))
      .filter((r) => !term || `${r.name} ${r.email} ${r.phone}`.toLowerCase().includes(term))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const start = cursor ? Number(cursor) : 0;
    return {
      items: all.slice(start, start + limit).map(strip),
      total: all.length,
      nextCursor: start + limit < all.length ? String(start + limit) : null,
    };
  },
  async decide(
    id: string,
    body: { approve: true; d: Decision } | { approve: false; reason: string },
  ) {
    await delay();
    const viewer = currentRole();
    if (!viewer || !canSee(viewer, '/sign-up-requests'))
      throw new SignUpError('You can’t review sign-up requests.', undefined, 403);
    const rows = load();
    const row = rows.find((r) => r.id === id);
    if (!row || row.status !== 'pending')
      throw new SignUpError('This request was already handled. Refresh the list.', undefined, 409);
    if (body.approve) {
      if (!reviewableRoles(viewer).includes(body.d.role))
        throw new SignUpError('You can only approve roles below your own.', 'role', 403);
      Object.assign(row, { status: 'approved', role: body.d.role, hqId: body.d.hqId });
    } else Object.assign(row, { status: 'rejected', reason: body.reason.trim() || null });
    save(rows);
    return strip(row);
  },
};

// ---------- real (assumed contract) ----------
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      credentials: 'include',
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new SignUpError('Could not reach the server. Check your connection.');
  }
  const body = (await res.json().catch(() => null)) as
    (T & { error?: { code?: string; message?: string } }) | null;
  if (!res.ok) {
    const code = body?.error?.code;
    if (res.status === 409 || code === 'EMAIL_TAKEN')
      throw new SignUpError('A request or account for this email already exists.', 'email', 409);
    if (res.status === 404)
      throw new SignUpError(
        'Sign-up requests are not available on this server yet.',
        undefined,
        404,
      );
    if (res.status === 403)
      throw new SignUpError('You can’t do that for this request.', undefined, 403);
    throw new SignUpError(
      body?.error?.message ?? 'Something went wrong. Try again.',
      undefined,
      res.status,
    );
  }
  return body as T;
}

const apiAdapter: typeof mockAdapter = {
  async submit(input) {
    const bad = validate(input);
    if (bad) throw bad;
    return call('/v1/auth/sign-up-request', {
      method: 'POST',
      body: JSON.stringify({ ...input, email: input.email.trim().toLowerCase() }),
    });
  },
  async publicHqs() {
    try {
      return (await call<{ items: Hq[] }>('/v1/public/hqs')).items;
    } catch {
      return [];
    }
  },
  async statusFor() {
    return null; // real mode: the sign-in response says so (ACCOUNT_PENDING)
  },
  async list(_viewer, { q = '', cursor, limit = 20 }) {
    const p = new URLSearchParams({
      status: 'pending',
      limit: String(limit),
      includeTotal: 'true',
    });
    if (q.trim()) p.set('q', q.trim());
    if (cursor) p.set('cursor', cursor);
    const r = await call<{ items: SignUpRequest[]; nextCursor: string | null; total?: number }>(
      `/v1/sign-up-requests?${p}`,
    );
    return { items: r.items, nextCursor: r.nextCursor, total: r.total ?? r.items.length };
  },
  async decide(id, body) {
    return body.approve
      ? call(`/v1/sign-up-requests/${id}/approve`, { method: 'POST', body: JSON.stringify(body.d) })
      : call(`/v1/sign-up-requests/${id}/reject`, {
          method: 'POST',
          body: JSON.stringify({ reason: body.reason.trim() || undefined }),
        });
  },
};

export const signupAdapter = REAL ? apiAdapter : mockAdapter;
