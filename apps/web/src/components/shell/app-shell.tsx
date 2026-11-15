'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SidebarInset, SidebarProvider } from '@ariforce/ui/components/sidebar';
import { AppSidebar } from './app-sidebar';
import { AuthGate } from '@/components/auth/auth-gate';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/lib/auth';
import { meQuery } from '@/lib/query';
import { ScrollReset } from './scroll-reset';
import { SiteHeader } from './site-header';
import { ConfirmedSessionProvider } from './role-context';

function SignedOut() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const next = pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
    router.replace(`/sign-in${next}`);
  }, [pathname, router]);
  return null;
}

/**
 * Fixed-height shell: the viewport (dvh, so iOS's dynamic toolbar is respected) never scrolls.
 * Header and sidebar are outside the only scroller, <main id="af-main">, which contains its own
 * overscroll, so nothing gets pulled down with Safari's elastic bounce.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const me = useQuery(meQuery);
  const session = useSession();
  if (me.isPending) return null;
  if (me.isError || session === undefined)
    return (
      <button type="button" className="m-6 text-sm underline" onClick={() => void me.refetch()}>
        Could not confirm your session. Try again.
      </button>
    );
  if (session === null) return <SignedOut />;
  return (
    <ConfirmedSessionProvider value={session}>
      <SidebarProvider className="flex h-dvh min-h-0 flex-col overflow-hidden [--header-height:calc(3.5rem+env(safe-area-inset-top))]">
        <SiteHeader />
        <div className="flex min-h-0 flex-1">
          <AppSidebar />
          <SidebarInset
            id="af-main"
            data-testid="app-main"
            className="af-page af-scroll min-h-0 min-w-0 overflow-y-auto pb-[env(safe-area-inset-bottom)]"
          >
            <ScrollReset />
            <AuthGate>{children}</AuthGate>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </ConfirmedSessionProvider>
  );
}
