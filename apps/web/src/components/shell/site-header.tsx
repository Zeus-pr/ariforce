'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Bell, Search } from 'lucide-react';
import { Avatar, AvatarFallback } from '@ariforce/ui/components/avatar';
import { Button } from '@ariforce/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ariforce/ui/components/dropdown-menu';
import { Input } from '@ariforce/ui/components/input';
import { SidebarTrigger } from '@ariforce/ui/components/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ariforce/ui/components/tooltip';
import { ROLE_LABEL, type Role } from '@/lib/nav';
import { useRole } from './role-context';
import { ThemeToggle } from './theme-toggle';

export function SiteHeader() {
  const { role, setRole } = useRole();
  return (
    <header className="sticky top-0 z-30 flex h-(--header-height) w-full shrink-0 items-center gap-2 border-b bg-card px-3 sm:px-4">
      {/* The splash logo lands on this exact box ([data-af-header-logo]); keep its size and position stable. */}
      <Link href="/" className="flex items-center gap-2.5 rounded-md pr-1" aria-label="AriForce home">
        <span className="relative block">
          {/* Dark mode only: a light plate so the navy mark stays legible. Sits behind the logo and
              outside its box, so the splash landing target is unchanged. */}
          <span aria-hidden className="af-page absolute -inset-1 hidden rounded-md bg-white dark:block" />
          <Image
          src="/brand/ariforce-mark.png"
          alt=""
          width={36}
          height={32}
          priority
          data-af-header-logo
            className="relative block h-8 w-9"
          />
        </span>
        <span className="af-page text-[17px] font-semibold tracking-tight text-primary">AriForce</span>
      </Link>

      <div className="af-page flex flex-1 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger className="ml-1 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>Toggle sidebar (Ctrl/⌘ B)</TooltipContent>
        </Tooltip>

        <div className="relative ml-2 hidden max-w-sm flex-1 md:block">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search reps, doctors, territories"
            className="h-9 bg-background pl-8"
            aria-label="Search"
          />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Notifications" className="text-muted-foreground">
                <Bell className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Notifications</TooltipContent>
          </Tooltip>

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 gap-2 px-1.5 sm:px-2" aria-label="Account menu">
                <Avatar className="size-7">
                  <AvatarFallback className="bg-primary text-[11px] font-medium text-primary-foreground">
                    PC
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block text-sm font-medium">Prajesh Choudhury</span>
                  <span className="block text-xs text-muted-foreground">{ROLE_LABEL[role]}</span>
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Preview as role (mock)
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup value={role} onValueChange={(v) => setRole(v as Role)}>
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                  <DropdownMenuRadioItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>Profile</DropdownMenuItem>
              <DropdownMenuItem disabled>Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
