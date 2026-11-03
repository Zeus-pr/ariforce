'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { AuditLogEntry } from '@ariforce/contracts';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import { todayIST } from '@/components/attendance/format';
import { EVERYONE, PersonPicker } from '@/components/team/person-picker';
import { api, apiReady } from '@/lib/api';
import { failureMessage } from '@/lib/dcr/errors';
import { ROLE_SHORT } from '@/lib/roles';
import { RANGE_LABEL, rangeOf, type RangeKey } from '@/lib/team/range';

type AuditPage = { items: AuditLogEntry[]; nextCursor: string | null };

/** Action prefixes the server accepts ("dcr." matches every dcr.* action). */
const AREAS = [
  ['', 'All actions'],
  ['dcr.', 'DCR'],
  ['expense.', 'Expenses'],
  ['approval.', 'Approvals'],
  ['leave.', 'Leave'],
  ['tour_plan.', 'Tour plans'],
  ['auth.', 'Sign-in'],
] as const;

const at = (t: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(t));

function Json({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/**
 * Who did what and when (GET /v1/audit-log, Director and System Admin). Values of sensitive keys
 * arrive already redacted from the server; nothing here unmasks them.
 */
export function AuditViewer() {
  const [person, setPerson] = useState(EVERYONE);
  const [area, setArea] = useState('');
  const [range, setRange] = useState<RangeKey>('week');
  const [open, setOpen] = useState<string | null>(null);
  const { from, to } = rangeOf(range, todayIST());

  const q = useInfiniteQuery({
    queryKey: ['audit-log', person, area, from, to],
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: AuditPage) => last.nextCursor ?? undefined,
    queryFn: async ({ pageParam }): Promise<AuditPage> => {
      await apiReady();
      const r = await api.GET('/v1/audit-log', {
        params: {
          query: {
            limit: 50,
            from,
            to,
            ...(person ? { actorUserId: person } : {}),
            ...(area ? { action: area } : {}),
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
      });
      if (!r.data) throw new Error(failureMessage(r, 'Could not load the audit log.'));
      return r.data;
    },
  });

  const rows: AuditLogEntry[] = q.data?.pages.flatMap((p: AuditPage) => p.items) ?? [];
  const select = 'h-11 w-full rounded-md border bg-card px-3 text-sm md:h-9';

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[16rem_10rem_10rem]">
        <div className="col-span-2 sm:col-span-1">
          <PersonPicker value={person} onChange={setPerson} testId="audit-person" />
        </div>
        <select
          aria-label="Action"
          value={area}
          onChange={(e) => setArea(e.target.value)}
          className={select}
        >
          {AREAS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label="Period"
          value={range}
          onChange={(e) => setRange(e.target.value as RangeKey)}
          className={select}
        >
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
            <option key={k} value={k}>
              {RANGE_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {q.error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-danger-soft p-3 text-sm"
        >
          <span>{(q.error as Error).message}</span>
          <button type="button" className="shrink-0 underline" onClick={() => void q.refetch()}>
            Try again
          </button>
        </div>
      ) : q.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No activity matches these filters.
        </p>
      ) : (
        <>
          <ul className="divide-y rounded-lg border bg-card text-sm" data-testid="audit-rows">
            {rows.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  aria-expanded={open === e.id}
                  onClick={() => setOpen(open === e.id ? null : e.id)}
                  className="flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-muted/50"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">
                      {e.actor ? e.actor.name : 'System'}
                      {e.actor?.role && (
                        <span className="ml-2 font-normal text-muted-foreground">
                          {ROLE_SHORT[e.actor.role]}
                        </span>
                      )}
                    </span>
                    <Badge variant="secondary" className="shrink-0 font-mono font-normal">
                      {e.action}
                    </Badge>
                  </span>
                  <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">
                      {e.entityType ?? 'no entity'}
                      {e.entityId ? ` · ${e.entityId}` : ''}
                    </span>
                    <span className="shrink-0">{at(e.at)}</span>
                  </span>
                </button>
                {open === e.id && (
                  <div className="flex flex-col gap-3 border-t px-4 py-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Json label="Before" value={e.before} />
                      <Json label="After" value={e.after} />
                    </div>
                    <dl className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                      {e.ip && <div className="truncate">IP {e.ip}</div>}
                      {e.requestId && <div className="truncate">Request {e.requestId}</div>}
                      {e.userAgent && <div className="truncate sm:col-span-2">{e.userAgent}</div>}
                    </dl>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <Button
              variant="outline"
              className="self-center"
              disabled={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
