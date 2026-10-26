import { SidebarInset, SidebarProvider } from '@ariforce/ui/components/sidebar';
import { AppSidebar } from './app-sidebar';
import { RoleProvider } from './role-context';
import { SiteHeader } from './site-header';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <RoleProvider>
      <SidebarProvider className="flex flex-col [--header-height:3.5rem]">
        <SiteHeader />
        <div className="flex flex-1">
          <AppSidebar />
          <SidebarInset className="af-page min-w-0">{children}</SidebarInset>
        </div>
      </SidebarProvider>
    </RoleProvider>
  );
}
