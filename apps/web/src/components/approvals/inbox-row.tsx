'use client';

import { useState, type ReactNode } from 'react';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import { ROLE_SHORT } from '@/lib/roles';
import type { Approval } from '@ariforce/contracts';

/**
 * One approval line, shared by "Waiting for me" and "Everyone": who and what, the decision buttons
 * always visible, and the full details opening right underneath (never another page).
 */
export function InboxRow({
  name,
  role,
  badge,
  summary,
  meta,
  actions,
  body,
  details,
}: {
  name: string;
  role?: Approval['requestedByRole'];
  badge: string;
  summary: string;
  meta?: ReactNode;
  actions?: ReactNode;
  body?: ReactNode;
  details?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col gap-2 px-4 py-3" data-testid="inbox-row">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {name}
            {role && (
              <span className="ml-2 font-normal text-muted-foreground">{ROLE_SHORT[role]}</span>
            )}
          </p>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </div>
        <Badge variant="secondary" className="shrink-0 font-normal">
          {badge}
        </Badge>
      </div>
      {body}
      {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
      {(actions || details) && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {details && (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              data-testid="approval-view"
            >
              {open ? 'Hide details' : 'View details'}
            </Button>
          )}
        </div>
      )}
      {open && details}
    </li>
  );
}
