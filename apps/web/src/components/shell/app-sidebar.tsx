'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  // Only sections the user just opened animate in; nothing animates on first paint (the splash owns that moment).
  const [opened, setOpened] = useState<NavSectionId | null>(null);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]');
      if (Array.isArray(v)) setClosed(v);
    } catch {
      // Corrupt value: keep every section open.
    }
  }, []);
  const toggle = (id: NavSectionId) => {
    setOpened(closed.includes(id) ? id : null);
    setClosed((c) => {
      const next = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      return next;
    });
  };
  return { closed, opened, toggle };
}

// Layout follows the shadcn/ui "sidebar-16" block (sidebar under a sticky site header), MIT.
export function AppSidebar() {
  const { role } = useRole();
  const pathname = usePathname();
  const { state, isMobile, setOpenMobile } = useSidebar();
  // The mobile sidebar is a modal sheet: close it once a link navigates, or it keeps covering the page and
  // swallows taps (dropdowns and buttons underneath seemed to "do nothing").
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);
  const iconOnly = state === 'collapsed' && !isMobile;
  const { closed, opened, toggle } = useClosedSections();
  const items = NAV.filter((i) => i.roles.includes(role));
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const navRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [glide, setGlide] = useState(false);
  const measure = useCallback(() => {
    const root = navRef.current;
    const active = root?.querySelector<HTMLElement>('[data-active="true"]');
    if (!root || !active) {
      setPill(null);
      return;
    }
    const rootBox = root.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    setPill({
      x: box.left - rootBox.left,
      y: box.top - rootBox.top,
      w: box.width,
      h: box.height,
    });
  }, []);
  useLayoutEffect(() => {
    measure();
  }, [measure, pathname, iconOnly, closed, opened]);
  useEffect(() => {
    const root = navRef.current;
    if (!root) return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGlide(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <Sidebar
      collapsible="icon"
      className="af-page top-(--header-height) h-[calc(100dvh-var(--header-height))]!"
    >
      <SidebarContent className="gap-0">
        <div ref={navRef} className="relative">
          {pill && (
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute top-0 left-0 z-0 rounded-md bg-teal-100',
                glide &&
                  'transition-[transform,width,height] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
              )}
              style={{
                width: pill.w,
                height: pill.h,
                transform: `translate(${pill.x}px, ${pill.y}px)`,
              }}
            />
          )}
          {NAV_SECTIONS.map((section) => {
            const list = items.filter((i) => i.section === section.id);
            if (list.length === 0) return null;
            const hasActive = list.some((i) => isActive(i.href));
            // The section holding the current page never hides it; icon-only mode always shows every icon.
            const open = iconOnly || hasActive || !closed.includes(section.id);
            const id = `nav-${section.id}`;
            return (
              <SidebarGroup
                key={section.id}
                className="py-1"
                data-testid="nav-section"
                data-section={section.id}
              >
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
                  <SidebarGroupContent id={id} className={cn(opened === section.id && 'af-fade')}>
                    <SidebarMenu>
                      {list.map((item) => (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive(item.href)}
                            tooltip={item.title}
                            className="relative z-10 data-[active=true]:bg-transparent! data-[active=true]:text-teal-700! data-[active=true]:hover:bg-transparent!"
                          >
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
        </div>
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 pb-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          ARIGHNA PHARMA PVT. LTD. · {ROLE_LABEL[role]}
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
