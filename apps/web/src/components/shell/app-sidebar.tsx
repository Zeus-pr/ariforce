'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@ariforce/ui/components/sidebar';
import { NAV, ROLE_LABEL } from '@/lib/nav';
import { isApprover } from '@/lib/roles';
import { useRole } from './role-context';

// Layout follows the shadcn/ui "sidebar-16" block (sidebar under a sticky site header), MIT.
export function AppSidebar() {
  const { role } = useRole();
  const pathname = usePathname();
  const items = NAV.filter((i) => i.roles.includes(role));

  return (
    <Sidebar
      collapsible="icon"
      className="af-page top-(--header-height) h-[calc(100svh-var(--header-height))]!"
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.slug === 'tour-plans' && isApprover(role) && <SidebarMenuBadge>3</SidebarMenuBadge>}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 pb-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          Arighna Pharmaceutical · {ROLE_LABEL[role]}
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
