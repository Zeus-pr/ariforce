/**
 * Authentication. In mock mode (default): There is no server, no real credential and nothing secret here: one demo user
 * per role and a shared demo password that is printed on the sign-in page. The session is a user id in
 * localStorage. In real mode (NEXT_PUBLIC_API_MODE=real) signInReal uses better-auth + GET /v1/me and keeps
 * only the profile in localStorage (the session itself is the HTTP-only cookie).
 */
import { useSyncExternalStore } from 'react';
import { ROLES, ROLE_LABEL, roleLevel, type Role } from './roles';
import { API_URL, REAL, api, setAccountStateHandler, setUnauthenticatedHandler } from './api';

export const MOCK_PASSWORD = 'ariforce-demo';
import { SESSION_KEY } from './auth-boot';

export { SESSION_KEY };

export type MockUser = { id: string; name: string; email: string; role: Role; territory: string };

const NAMES: Partial<Record<Role, [string, string]>> = {
  business_manager: ['Rahul Sen', 'Kolkata South HQ'],
  area_business_manager: ['Priya Ghosh', 'Kolkata Area'],
  regional_business_manager: ['Arjun Das', 'East Bengal Region'],
  zonal_business_manager: ['Meera Iyer', 'East Zone'],
  sales_manager: ['Vikram Rao', 'India'],
  general_manager: ['Anita Kapoor', 'India'],
  vice_president: ['Sanjay Mehta', 'India'],
  director: ['Kavita Bose', 'India'],
  system_admin: ['System Admin', 'Head office'],
  accountant: ['Ritu Dey', 'Head office'],
};

const EMAIL: Partial<Record<Role, string>> = {
  business_manager: 'bm',
  area_business_manager: 'abm',
  regional_business_manager: 'rbm',
  zonal_business_manager: 'zbm',
  sales_manager: 'sm',
  general_manager: 'gm',
  vice_president: 'vp',
  director: 'director',
  system_admin: 'admin',
  accountant: 'accounts',
};

/** Demo users for the web's roles (the functional roles have no web pages yet). */
export const MOCK_USERS: MockUser[] = ROLES.filter((r) => NAMES[r] && EMAIL[r]).map((role) => ({
  id: `mock-${EMAIL[role]}`,
  name: NAMES[role]![0],
  territory: NAMES[role]![1],
  email: `${EMAIL[role]}@demo.ariforce.test`,
  role,
}));

/** `role` is copied in so the pre-paint head script can gate routes without the user table. */
export type Session = { userId: string; role?: Role; previewRole?: Role; user?: MockUser };
export type SignedIn = { user: MockUser; role: Role; previewing: boolean };

let cache: { raw: string | null; value: SignedIn | null } = { raw: null, value: null };
const listeners = new Set<() => void>();

function read(): SignedIn | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SESSION_KEY);
  } catch {
    // storage blocked (private mode): treat as signed out
  }
  if (raw === cache.raw) return cache.value;
  let value: SignedIn | null = null;
  try {
    const s = raw ? (JSON.parse(raw) as Session) : null;
    // Real mode: the user came from GET /v1/me at sign-in. Mock mode: one of the demo users.
    const user =
      s &&
      (REAL
        ? s.user?.id === s.userId
          ? s.user
          : undefined
        : MOCK_USERS.find((u) => u.id === s.userId));
    if (user) {
      const preview = s.previewRole && ROLES.includes(s.previewRole) ? s.previewRole : undefined;
      value = { user, role: preview ?? user.role, previewing: !!preview && preview !== user.role };
    }
  } catch {
    // storage blocked (private mode): treat as signed out
  }
  cache = { raw, value };
  return value;
}

function write(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage blocked (private mode): treat as signed out
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => e.key === SESSION_KEY && l();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
}

/** `undefined` while rendering on the server or hydrating; `null` when signed out. */
export function useSession(): SignedIn | null | undefined {
  return useSyncExternalStore(subscribe, read, () => undefined);
}

export type SignInError = {
  field: 'email' | 'password';
  message: string;
  /** Set when the identity exists but an admin has not approved it (CONTRACT-GAPS #23). */
  account?: 'pending' | 'rejected';
};

export const PENDING_MESSAGE =
  'Your account is awaiting approval. You can sign in once an administrator approves it.';
export const REJECTED_MESSAGE =
  'Your sign-up request was not approved. Contact your administrator.';

export function signIn(email: string, password: string): MockUser | SignInError {
  const e = email.trim().toLowerCase();
  if (!e) return { field: 'email', message: 'Enter your work email.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    return { field: 'email', message: 'That doesn\u2019t look like an email address.' };
  if (!password) return { field: 'password', message: 'Enter your password.' };
  const user = MOCK_USERS.find((u) => u.email === e);
  if (!user)
    return {
      field: 'email',
      message: 'No demo account uses this email. Pick one from the list below.',
    };
  if (password !== MOCK_PASSWORD)
    return { field: 'password', message: `Wrong password. The demo password is ${MOCK_PASSWORD}.` };
  write({ userId: user.id, role: user.role });
  return user;
}

export function signOut() {
  if (REAL)
    void fetch(`${API_URL}/v1/auth/sign-out`, { method: 'POST', credentials: 'include' }).catch(
      () => {},
    );
  write(null);
}

/** Highest sales role wins; system admin only when nothing else; unknown functional roles fall back to BM. */
function primaryRole(roles: string[]): Role {
  const known = roles.filter((r): r is Role => (ROLES as readonly string[]).includes(r));
  const sales = known
    .filter((r) => r !== 'system_admin')
    .sort((a, b) => roleLevel(b) - roleLevel(a));
  return sales[0] ?? (known.includes('system_admin') ? 'system_admin' : 'business_manager');
}

/** REAL mode sign-in: better-auth email sign-in (session cookie), then GET /v1/me. */
export async function signInReal(email: string, password: string): Promise<MockUser | SignInError> {
  const e = email.trim().toLowerCase();
  if (!e) return { field: 'email', message: 'Enter your work email.' };
  if (!password) return { field: 'password', message: 'Enter your password.' };
  try {
    const res = await fetch(`${API_URL}/v1/auth/sign-in/email`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: e, password }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 403) {
      // better-auth shape { code, message } (no error wrapper); accept the wrapped shape too.
      const b = (await res.json().catch(() => null)) as {
        error?: { code?: string };
        code?: string;
      } | null;
      const code = b?.code ?? b?.error?.code;
      if (code === 'ACCOUNT_PENDING_APPROVAL')
        return { field: 'password', message: PENDING_MESSAGE, account: 'pending' };
      if (code === 'ACCOUNT_REJECTED')
        return { field: 'password', message: REJECTED_MESSAGE, account: 'rejected' };
    }
    if (res.status === 401 || res.status === 400 || res.status === 403)
      return { field: 'password', message: 'Email or password is wrong.' };
    if (!res.ok) return { field: 'password', message: 'Could not sign in. Try again in a moment.' };
    const { data: me } = await api.GET('/v1/me');
    if (!me)
      return { field: 'password', message: 'Signed in, but your profile could not be loaded.' };
    const role = primaryRole(me.roles);
    const user: MockUser = {
      id: me.id,
      name: me.name,
      email: me.email,
      role,
      territory: me.companyName,
    };
    write({ userId: me.id, role, user });
    return user;
  } catch {
    return { field: 'password', message: 'Could not reach the server. Check your connection.' };
  }
}

if (typeof window !== 'undefined')
  setAccountStateHandler((state) => {
    write(null);
    if (!location.pathname.startsWith('/sign-in')) location.replace(`/sign-in?account=${state}`);
  });

if (typeof window !== 'undefined')
  setUnauthenticatedHandler(() => {
    const p = location.pathname;
    write(null);
    if (!p.startsWith('/sign-in'))
      location.replace(
        `/sign-in${p !== '/' ? `?next=${encodeURIComponent(p + location.search)}` : ''}`,
      );
  });

export function setPreviewRole(role: Role) {
  const s = read();
  if (s)
    write({
      userId: s.user.id,
      role: s.user.role,
      previewRole: role === s.user.role ? undefined : role,
    });
}

export const roleLabel = (r: Role) => ROLE_LABEL[r];
