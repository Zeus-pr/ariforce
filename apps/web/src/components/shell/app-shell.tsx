import { SidebarInset, SidebarProvider } from '@ariforce/ui/components/sidebar';
import { AppSidebar } from './app-sidebar';
import { AuthGate } from '@/components/auth/auth-gate';
import { SiteHeader } from './site-header';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SidebarProvider className="flex flex-col [--header-height:3.5rem]">
        <SiteHeader />
        <div className="flex flex-1">
          <AppSidebar />
          <SidebarInset className="af-page min-w-0">
            <AuthGate>{children}</AuthGate>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </>
  );
}
