'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth';
import { canSee, homeFor } from '@/lib/nav';

/**
 * Client guard for the signed-in app. Hard loads are already redirected by the inline head script
 * (authBootScript) before paint; this covers sign-out and client navigation. Protected content only
 * renders when a session exists (or during SSR/hydration, where the head script has already run).
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

  if (session === null) return null;
  if (session && !allowed) return null;
  return <>{children}</>;
}
