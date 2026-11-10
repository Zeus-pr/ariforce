'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth';
import { canSee, homeFor } from '@/lib/nav';

/**
 * Client guard for the signed-in app. The role comes from GET /v1/me (useSession), not from the
 * profile stored in localStorage. Nothing renders until that answer is in.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const allowed = session ? canSee(session.role, pathname) : false;

  useEffect(() => {
    if (session === null) {
      const next = pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
      router.replace(`/sign-in${next}`);
    } else if (session && !allowed) {
      router.replace(homeFor(session.role));
    }
  }, [session, allowed, pathname, router]);

  if (!session || !allowed) return null;
  return <>{children}</>;
}
