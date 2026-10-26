'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@ariforce/ui/components/sidebar';
import { cn } from '@ariforce/ui/lib/utils';
import { NAV, NAV_SECTIONS, ROLE_LABEL, type NavSectionId } from '@/lib/nav';
import { useRole } from './role-context';

const OPEN_KEY = 'af:nav-closed';

/** Closed sections persist per browser; every section starts open. */
function useClosedSections() {
  const [closed, setClosed] = useState<NavSectionId[]>([]);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]');
      if (Array.isArray(v)) setClosed(v);
    } catch {
      // Corrupt value: keep every section open.
    }
  }, []);
  const toggle = (id: NavSectionId) =>
    setClosed((c) => {
      const next = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      return next;
    });
  return { closed, toggle };
}

// Layout follows the shadcn/ui "sidebar-16" block (sidebar under a sticky site header), MIT.
export function AppSidebar() {
  const { role } = useRole();
  const pathname = usePathname();
  const { state, isMobile } = useSidebar();
  const iconOnly = state === 'collapsed' && !isMobile;
  const { closed, toggle } = useClosedSections();
  const items = NAV.filter((i) => i.roles.includes(role));
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <Sidebar collapsible="icon" className="af-page top-(--header-height) h-[calc(100svh-var(--header-height))]!">
      <SidebarContent className="gap-0">
        {NAV_SECTIONS.map((section) => {
          const list = items.filter((i) => i.section === section.id);
          if (list.length === 0) return null;
          const hasActive = list.some((i) => isActive(i.href));
          // The section holding the current page never hides it; icon-only mode always shows every icon.
          const open = iconOnly || hasActive || !closed.includes(section.id);
          const id = `nav-${section.id}`;
          return (
            <SidebarGroup key={section.id} className="py-1" data-testid="nav-section" data-section={section.id}>
              <SidebarGroupLabel asChild>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={id}
                  onClick={() => !hasActive && toggle(section.id)}
                  className="w-full justify-between hover:text-sidebar-foreground"
                >
                  {section.title}
                  <ChevronRight
                    className={cn(
                      'transition-transform duration-200 ease-(--ease-out) motion-reduce:transition-none',
                      open && 'rotate-90',
                      hasActive && 'opacity-40',
                    )}
                  />
                </button>
              </SidebarGroupLabel>
              {open && (
                <SidebarGroupContent id={id} className="af-fade">
                  <SidebarMenu>
                    {list.map((item) => (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.title}>
                          <Link href={item.href} data-testid="nav-item">
                            <item.icon />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              )}
            </SidebarGroup>
          );
        })}
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
