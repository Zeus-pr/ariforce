'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogOut, Search } from 'lucide-react';
import { Avatar, AvatarFallback } from '@ariforce/ui/components/avatar';
import { Button } from '@ariforce/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ariforce/ui/components/dropdown-menu';
import { SidebarTrigger } from '@ariforce/ui/components/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ariforce/ui/components/tooltip';
import { signOut } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/roles';
import { CommandPalette } from '@/components/search/command-palette';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { useRole } from './role-context';

export function SiteHeader() {
  const { role, user } = useRole();
  const router = useRouter();
  const name = user?.name ?? '';
  const [searchOpen, setSearchOpen] = useState(false);
  const [mac, setMac] = useState(true);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const onSignOut = () => {
    signOut();
    router.replace('/sign-in');
  };
  return (
    <header className="z-30 flex h-(--header-height) w-full shrink-0 items-center gap-2 border-b bg-card px-3 pt-[env(safe-area-inset-top)] sm:px-4">
      {/* The splash logo lands on this exact box ([data-af-header-logo]); keep its size and position stable. */}
      <Link
        href="/"
        className="flex items-center gap-2.5 rounded-md pr-1"
        aria-label="AriForce home"
      >
        <Image
          src="/brand/ariforce-mark.png"
          alt=""
          width={36}
          height={32}
          priority
          data-af-header-logo
          className="block h-8 w-9"
        />
        <span className="af-page text-[17px] font-semibold tracking-tight text-primary">
          AriForce
        </span>
      </Link>

      <div className="af-page flex flex-1 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger className="ml-1 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>Toggle sidebar (Ctrl/⌘ B)</TooltipContent>
        </Tooltip>

        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.focus(); // Safari does not focus buttons on click; focus returns here on close
            setSearchOpen(true);
          }}
          aria-haspopup="dialog"
          aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
          data-testid="search-trigger"
          className="ml-2 hidden h-9 max-w-sm flex-1 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-left text-sm text-muted-foreground shadow-xs transition-colors hover:border-ring/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none md:flex"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate">Search doctors, chemists, team…</span>
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-[11px]">
            {mac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>
        <CommandPalette role={role} open={searchOpen} onOpenChange={setSearchOpen} />

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search"
            data-testid="search-trigger-mobile"
            className="text-muted-foreground md:hidden"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="size-4" />
          </Button>
          <NotificationBell />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-9 gap-2 px-1.5 sm:px-2"
                aria-label="Account menu"
              >
                <Avatar className="size-7">
                  <AvatarFallback className="bg-primary text-[11px] font-medium text-primary-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block text-sm font-medium">{name}</span>
                  <span className="block text-xs text-muted-foreground">{ROLE_LABEL[role]}</span>
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="font-normal">
                <span className="block text-sm font-medium">{name}</span>
                <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onSignOut} data-testid="sign-out">
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
