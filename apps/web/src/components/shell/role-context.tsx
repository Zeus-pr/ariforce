'use client';

import { setPreviewRole, useSession, type MockUser } from '@/lib/mock-auth';
import type { Role } from '@/lib/roles';

/**
 * The effective role comes from the mock session; "Preview as role" overrides it for demos.
 * Inside the (app) group <AuthGate> guarantees a session before children render on the client.
 */
export function useRole(): { role: Role; setRole: (r: Role) => void; user: MockUser | null; previewing: boolean } {
  const s = useSession();
  return {
    role: s?.role ?? 'business_manager',
    setRole: setPreviewRole,
    user: s?.user ?? null,
    previewing: !!s?.previewing,
  };
}
