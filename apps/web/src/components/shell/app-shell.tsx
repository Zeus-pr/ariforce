import { SidebarInset, SidebarProvider } from '@ariforce/ui/components/sidebar';
import { AppSidebar } from './app-sidebar';
import { AuthGate } from '@/components/auth/auth-gate';
import { ScrollReset } from './scroll-reset';
import { SiteHeader } from './site-header';

/**
 * Fixed-height shell: the viewport (dvh, so iOS's dynamic toolbar is respected) never scrolls.
 * Header and sidebar are outside the only scroller, <main id="af-main">, which contains its own
 * overscroll, so nothing gets pulled down with Safari's elastic bounce.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
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
  );
}
