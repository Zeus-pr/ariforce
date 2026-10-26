/**
 * MOCK authentication. There is no server, no real credential and nothing secret here: one demo user
 * per role and a shared demo password that is printed on the sign-in page. The session is a user id in
 * localStorage. Replace this module when real auth (#5) and the Architect's auth contract land.
 */
import { useSyncExternalStore } from 'react';
import { ROLES, ROLE_LABEL, type Role } from './roles';

export const MOCK_PASSWORD = 'ariforce-demo';
import { SESSION_KEY } from './auth-boot';

export { SESSION_KEY };

export type MockUser = { id: string; name: string; email: string; role: Role; territory: string };

const NAMES: Record<Role, [string, string]> = {
  business_manager: ['Rahul Sen', 'Kolkata South HQ'],
  area_business_manager: ['Priya Ghosh', 'Kolkata Area'],
  regional_business_manager: ['Arjun Das', 'East Bengal Region'],
  zonal_business_manager: ['Meera Iyer', 'East Zone'],
  sales_manager: ['Vikram Rao', 'India'],
  general_manager: ['Anita Kapoor', 'India'],
  vice_president: ['Sanjay Mehta', 'India'],
  director: ['Kavita Bose', 'India'],
  system_admin: ['System Admin', 'Head office'],
};

const EMAIL: Record<Role, string> = {
  business_manager: 'bm',
  area_business_manager: 'abm',
  regional_business_manager: 'rbm',
  zonal_business_manager: 'zbm',
  sales_manager: 'sm',
  general_manager: 'gm',
  vice_president: 'vp',
  director: 'director',
  system_admin: 'admin',
};

export const MOCK_USERS: MockUser[] = ROLES.map((role) => ({
  id: `mock-${EMAIL[role]}`,
  name: NAMES[role][0],
  territory: NAMES[role][1],
  email: `${EMAIL[role]}@demo.ariforce.test`,
  role,
}));

/** `role` is copied in so the pre-paint head script can gate routes without the user table. */
export type Session = { userId: string; role?: Role; previewRole?: Role };
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
    const user = s && MOCK_USERS.find((u) => u.id === s.userId);
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

export type SignInError = { field: 'email' | 'password'; message: string };

export function signIn(email: string, password: string): MockUser | SignInError {
  const e = email.trim().toLowerCase();
  if (!e) return { field: 'email', message: 'Enter your work email.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { field: 'email', message: 'That doesn\u2019t look like an email address.' };
  if (!password) return { field: 'password', message: 'Enter your password.' };
  const user = MOCK_USERS.find((u) => u.email === e);
  if (!user) return { field: 'email', message: 'No demo account uses this email. Pick one from the list below.' };
  if (password !== MOCK_PASSWORD) return { field: 'password', message: `Wrong password. The demo password is ${MOCK_PASSWORD}.` };
  write({ userId: user.id, role: user.role });
  return user;
}

export function signOut() {
  write(null);
}

export function setPreviewRole(role: Role) {
  const s = read();
  if (s) write({ userId: s.user.id, role: s.user.role, previewRole: role === s.user.role ? undefined : role });
}

export const roleLabel = (r: Role) => ROLE_LABEL[r];

