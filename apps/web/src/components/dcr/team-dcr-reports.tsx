'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Dcr } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import { dateLabel } from '@/components/attendance/format';
import { useRole } from '@/components/shell/role-context';
import { EVERYONE, PersonPicker } from '@/components/team/person-picker';
import { api, apiReady, toApiError } from '@/lib/api';
import { thrownMessage } from '@/lib/dcr/errors';
import { useTeamPeople } from '@/lib/team/people';
import { RANGE_LABEL, rangeOf, type RangeKey } from '@/lib/team/range';

type Status = 'reported' | 'submitted' | 'approved' | 'rejected' | 'locked' | 'draft';
const STATUS_LABEL: Record<Status, string> = {
  reported: 'Any status',
  submitted: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Rejected',
  locked: 'Locked',
  draft: 'Draft',
};
const ROW_STATUS: Record<Dcr['status'], string> = {
  draft: 'Draft',
  submitted: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Rejected',
  locked: 'Locked',
};

type DcrPage = { items: Dcr[]; nextCursor: string | null };
const rawApi = api as unknown as {
  GET: (
    path: string,
    init?: { params?: { query?: Record<string, string | number> } },
  ) => Promise<{ data?: DcrPage; response: Response; error?: unknown }>;
};

async function loadDcrs(query: Record<string, string>) {
  await apiReady();
  const items: Dcr[] = [];
  let cursor: string | undefined;
  do {
    const r = await rawApi.GET('/v1/dcrs', {
      params: { query: { ...query, sort: '-date', limit: 100, ...(cursor ? { cursor } : {}) } },
    });
    if (!r.data) throw new Error(toApiError(r).message || 'Could not load team DCRs.');
    items.push(...r.data.items);
    cursor = r.data.nextCursor ?? undefined;
  } while (cursor && items.length < 1000);
  return items;
}

const select =
  'h-11 md:h-9 rounded-md border bg-card px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm';

/**
 * Team DCRs for managers and the Director: everyone the role can see (GET /v1/dcrs is
 * hierarchy-scoped by the API), filtered by person, period and status. Rows open the read-only report.
 */
export function TeamDcrReports({
  today,
  wtName,
}: {
  today: string;
  wtName: (id: string) => string | undefined;
}) {
  const { role, user } = useRole();
  const people = useTeamPeople(role);
  const [person, setPerson] = useState(EVERYONE);
  const [range, setRange] = useState<RangeKey>('week');
  const [status, setStatus] = useState<Status>('reported');
  const { from, to } = rangeOf(range, today);
  const q = useQuery({
    queryKey: ['team-dcrs', from, to, person, status],
    queryFn: () =>
      loadDcrs({
        from,
        to,
        ...(person ? { userId: person } : {}),
        ...(status !== 'reported' ? { status } : {}),
      }),
    staleTime: 60_000,
  });
  const rows = (q.data ?? []).filter(
    (d) => (person || d.userId !== user?.id) && (status === 'draft' || d.status !== 'draft'),
  );
  const name = (id: string) => people.data?.byId.get(id)?.name ?? 'Team member';

  return (
    <section className="flex flex-col gap-4" data-testid="team-dcr-reports">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[16rem_11rem_11rem]">
        <div className="col-span-2 sm:col-span-1">
          <PersonPicker value={person} onChange={setPerson} testId="team-dcr-person" />
        </div>
        <select
          aria-label="Period"
          value={range}
          onChange={(e) => setRange(e.target.value as RangeKey)}
          className={select}
          data-testid="team-dcr-range"
        >
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
            <option key={k} value={k}>
              {RANGE_LABEL[k]}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as Status)}
          className={select}
          data-testid="team-dcr-status"
        >
          {(Object.keys(STATUS_LABEL) as Status[]).map((k) => (
            <option key={k} value={k}>
              {STATUS_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {q.error ? (
        <div
          className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-danger-soft p-3 text-sm"
          role="alert"
        >
          <span>{thrownMessage(q.error)}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void q.refetch()}>
            Retry
          </Button>
        </div>
      ) : q.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground" data-testid="team-dcr-empty">
          No reports for {RANGE_LABEL[range].toLowerCase()}.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card" data-testid="team-dcr-list">
          {rows.map((d) => (
            <li key={d.id}>
              <Link
                href={`/dcr/reports/${d.id}`}
                className="block px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                data-testid="team-dcr-row"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{name(d.userId)}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {ROW_STATUS[d.status]}
                  </span>
                </span>
                <span className="block truncate text-sm text-muted-foreground">
                  {dateLabel(d.date)}
                  {wtName(d.workTypeId) ? ` · ${wtName(d.workTypeId)}` : ''}
                  {typeof d.callCount === 'number'
                    ? ` · ${d.callCount} call${d.callCount === 1 ? '' : 's'}`
                    : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
