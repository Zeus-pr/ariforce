/**
 * Production authentication using better-auth + GET /v1/me
 * Session is the HTTP-only cookie; profile is stored in localStorage.
 */
import { useSyncExternalStore } from 'react';
import { rateLimitMessage, SUSPENDED_MESSAGE } from '@/lib/auth-errors';
import { ROLES, ROLE_LABEL, roleLevel, type Role } from './roles';
import { API_URL, api, setAccountStateHandler, setUnauthenticatedHandler } from './api';

export { SESSION_KEY } from './auth-boot';

export type User = { id: string; name: string; email: string; role: Role; territory: string };

export type Session = { userId: string; role?: Role; user?: User };

export type SignedIn = { user: User; role: Role };

let cache: { raw: string | null; value: SignedIn | null } = { raw: null, value: null };
const listeners = new Set<() => void>();
const SESSION_KEY = 'ariforce-session';

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
    const user = s && s.user?.id === s.userId ? s.user : undefined;
    if (user) {
      value = { user, role: user.role };
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
  account?: 'pending' | 'rejected' | 'suspended';
};

export const NO_PORTAL_MESSAGE = 'Your role does not have access to this portal.';

export const PENDING_MESSAGE =
  'Your account is awaiting approval. You can sign in once an administrator approves it.';
export const REJECTED_MESSAGE =
  'Your sign-up request was not approved. Contact your administrator.';

/** Highest sales role wins; system admin only when nothing else; null when no role has portal access. */
function primaryRole(roles: string[]): Role | null {
  const known = roles.filter((r): r is Role => (ROLES as readonly string[]).includes(r));
  if (!known.length) return null;
  const sales = known
    .filter((r) => r !== 'system_admin')
    .sort((a, b) => roleLevel(b) - roleLevel(a));
  return sales[0] ?? (known.includes('system_admin') ? 'system_admin' : 'business_manager');
}

/** Sign in via better-auth email (session cookie), then GET /v1/me. */
export async function signIn(email: string, password: string): Promise<User | SignInError> {
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
    if (res.status === 429)
      return { field: 'password', message: rateLimitMessage({ response: res, error: await res.json().catch(() => null) }) };
    if (res.status === 403) {
      // better-auth shape { code, message } (no error wrapper); accept the wrapped shape too.
      const b = (await res.json().catch(() => null)) as {
        error?: { code?: string };
        code?: string;
      } | null;
      const code = b?.code ?? b?.error?.code;
      if (code === 'ACCOUNT_SUSPENDED')
        return { field: 'password', message: SUSPENDED_MESSAGE, account: 'suspended' };
      if (code === 'ACCOUNT_PENDING_APPROVAL')
        return { field: 'password', message: PENDING_MESSAGE, account: 'pending' };
      if (code === 'ACCOUNT_REJECTED')
        return { field: 'password', message: REJECTED_MESSAGE, account: 'rejected' };
      // 403 ROLE_RETIRED: every role this person holds is retired (Distribution Head, Accountant).
      if (code === 'ROLE_RETIRED') return { field: 'password', message: NO_PORTAL_MESSAGE };
    }
    if (res.status === 401 || res.status === 400 || res.status === 403)
      return { field: 'password', message: 'Email or password is wrong.' };
    if (!res.ok) return { field: 'password', message: 'Could not sign in. Try again in a moment.' };
    const { data: me } = await api.GET('/v1/me');
    if (!me)
      return { field: 'password', message: 'Signed in, but your profile could not be loaded.' };
    const role = primaryRole(me.roles);
    if (!role) {
      // Signed in, but no role with portal access (e.g. Distribution Head, Accountant): sign out again.
      void fetch(`${API_URL}/v1/auth/sign-out`, { method: 'POST', credentials: 'include' }).catch(() => {});
      return { field: 'password', message: NO_PORTAL_MESSAGE };
    }
    const user: User = {
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

export function signOut() {
  void fetch(`${API_URL}/v1/auth/sign-out`, { method: 'POST', credentials: 'include' }).catch(
    () => {},
  );
  write(null);
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

export const roleLabel = (r: Role) => ROLE_LABEL[r];
