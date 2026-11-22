'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CalendarOff,
  FileText,
  GitFork,
  LayoutDashboard,
  Map,
  ReceiptText,
  Users,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { PageTransition } from '@/components/animate-ui/components/page-transition';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from '@ariforce/ui/components/sidebar';
import { DEFAULT_ROLE_PERMISSIONS } from '@ariforce/contracts';
import { useSession } from '@/lib/auth';
import { meQuery } from '@/lib/query';
import { homeFor } from '@/lib/nav';
import { isSystemAdmin, type Role } from '@/lib/roles';
import { SiteHeader } from '@/components/shell/site-header';
import { ConfirmedSessionProvider } from '@/components/shell/role-context';
import { ScrollReset } from '@/components/shell/scroll-reset';

export function canOpenHrms(role: Role) {
  return (
    role === 'hr' ||
    ((isSystemAdmin(role) || role === 'director') &&
      (DEFAULT_ROLE_PERMISSIONS[role] ?? []).includes('users:write'))
  );
}

const NAV = [
  { href: '/hr', title: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/hr/employees', title: 'People', icon: Users, exact: false },
  { href: '/hr/expenses', title: 'Expenses', icon: ReceiptText, exact: false },
  { href: '/hr/leave', title: 'Leave', icon: CalendarOff, exact: false },
  { href: '/hr/letters', title: 'Appointment letter', icon: FileText, exact: false },
  { href: '/hr/org', title: 'Organizational chart', icon: GitFork, exact: false },
  { href: '/hr/organization', title: 'Organization', icon: Map, exact: false },
];

function HrNav({ path }: { path: string }) {
  const { setOpenMobile } = useSidebar();
  useEffect(() => {
    setOpenMobile(false);
  }, [path, setOpenMobile]);
  return (
    <Sidebar
      collapsible="icon"
      className="af-page top-(--header-height) h-[calc(100dvh-var(--header-height))]!"
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>HR</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const on = item.exact
                  ? path === item.href
                  : path === item.href || path.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={on} tooltip={item.title}>
                      <Link href={item.href} aria-current={on ? 'page' : undefined}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

export function HrmsShell({ children }: { children: React.ReactNode }) {
  const me = useQuery(meQuery);
  const session = useSession();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (session === null) {
      const next = path !== '/' ? `?next=${encodeURIComponent(path)}` : '';
      router.replace(`/sign-in${next}`);
    }
  }, [session, router, path]);

  if (me.isPending || session === undefined) return <div className="min-h-dvh bg-background" />;
  if (me.isError)
    return (
      <button type="button" className="m-6 text-sm underline" onClick={() => void me.refetch()}>
        Could not confirm your session. Try again.
      </button>
    );
  if (session === null) return <div className="min-h-dvh bg-background" />;

  return (
    <ConfirmedSessionProvider value={session}>
      <SidebarProvider className="flex h-dvh min-h-0 flex-col overflow-hidden [--header-height:calc(3.5rem+env(safe-area-inset-top))]">
        <SiteHeader homeHref="/hr" showSearch={false} />
        <div className="flex min-h-0 flex-1">
          <HrNav path={path} />
          <SidebarInset
            id="af-main"
            className="af-page af-scroll min-h-0 min-w-0 overflow-y-auto pb-[env(safe-area-inset-bottom)]"
          >
            <PageTransition effect="slide">
              <ScrollReset />
              {canOpenHrms(session.role) ? (
                children
              ) : (
                <div className="mx-auto max-w-lg p-6">
                  <h1 className="text-lg font-semibold">This account is for the field desk</h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    HR is open to HR, a director, or a system admin. Your sign-in can continue in
                    Fieldforce.
                  </p>
                  <Link
                    href={homeFor(session.role)}
                    className="mt-4 inline-block text-sm font-medium text-primary"
                  >
                    Open Fieldforce
                  </Link>
                </div>
              )}
            </PageTransition>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </ConfirmedSessionProvider>
  );
}
