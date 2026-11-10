'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SignedIn, User } from '@/lib/auth';
import type { Role } from '@/lib/roles';

const ConfirmedSession = createContext<SignedIn | null>(null);

/** Wraps the shell only after GET /v1/me has confirmed the role. */
export function ConfirmedSessionProvider({
  value,
  children,
}: {
  value: SignedIn;
  children: ReactNode;
}) {
  return <ConfirmedSession.Provider value={value}>{children}</ConfirmedSession.Provider>;
}

/**
 * The role is the one GET /v1/me returned. The unsigned profile in localStorage is not read.
 */
export function useRole(): { role: Role; user: User } {
  const s = useContext(ConfirmedSession);
  if (!s) throw new Error('useRole requires a confirmed session');
  return { role: s.role, user: s.user };
}
