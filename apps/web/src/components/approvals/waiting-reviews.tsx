'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Approval } from '@ariforce/contracts';
import { Badge } from '@ariforce/ui/components/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@ariforce/ui/components/card';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import { api, apiReady } from '@/lib/api';
import { failureMessage } from '@/lib/dcr/errors';
import { ROLE_SHORT } from '@/lib/roles';
import { ApprovalReview } from './approval-review';
import { SUBJECT_LABEL } from './approvals-queue';

/**
 * Daily reports and sign-up requests waiting on the caller. They are not approval requests, so
 * GET /v1/approvals?mine=to_decide never lists them; the org view (include=dcr,signup) does.
 */
export function WaitingReviews() {
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['approvals-org', 'waiting-reviews'],
    queryFn: async () => {
      await apiReady();
      const r = await api.GET('/v1/approvals', {
        params: { query: { scope: 'org', include: 'dcr,signup', status: 'pending', limit: 100 } },
      });
      if (!r.data) throw new Error(failureMessage(r, 'Could not load reports waiting on you.'));
      return (r.data.items as Approval[]).filter(
        (a) => (a.subjectType === 'dcr' || a.subjectType === 'signup') && a.canDecide !== false,
      );
    },
  });
  if (q.isError)
    return (
      <p className="text-sm text-destructive" role="alert">
        {(q.error as Error).message}
      </p>
    );
  if (!q.data) return <Skeleton className="h-24" aria-busy="true" />;
  if (q.data.length === 0) return null;
  return (
    <Card className="gap-0 py-0 shadow-xs" data-testid="waiting-reviews">
      <CardHeader className="border-b px-4 py-4">
        <CardTitle className="text-base">Daily reports and sign-ups</CardTitle>
        <CardDescription>{q.data.length} waiting on you</CardDescription>
      </CardHeader>
      <ul className="divide-y text-sm">
        {q.data.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              aria-expanded={open === a.id}
              onClick={() => setOpen(open === a.id ? null : a.id)}
              className="flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-muted/50"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">
                  {a.requestedByName}
                  {a.requestedByRole && (
                    <span className="ml-2 font-normal text-muted-foreground">
                      {ROLE_SHORT[a.requestedByRole]}
                    </span>
                  )}
                </span>
                <Badge variant="secondary" className="shrink-0 font-normal">
                  {SUBJECT_LABEL[a.subjectType] ?? a.subjectType}
                </Badge>
              </span>
              <span className="truncate text-muted-foreground">{a.summary}</span>
            </button>
            {open === a.id && (
              <div className="border-t px-4 py-4">
                <ApprovalReview approval={a} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
