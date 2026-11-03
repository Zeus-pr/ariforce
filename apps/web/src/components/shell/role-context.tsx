'use client';

import { useSession, type User } from '@/lib/auth';
import type { Role } from '@/lib/roles';

/**
 * The effective role comes from the session.
 * Inside the (app) group <AuthGate> guarantees a session before children render on the client.
 */
export function useRole(): { role: Role; user: User | null } {
  const s = useSession();
  return {
    role: s?.role ?? 'business_manager',
    user: s?.user ?? null,
  };
}
