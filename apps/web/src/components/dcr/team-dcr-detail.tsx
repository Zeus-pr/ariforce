'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import { dateLabel } from '@/components/attendance/format';
import { api, apiReady } from '@/lib/api';
import { failureMessage } from '@/lib/dcr/errors';
import { useTeamPeople } from '@/lib/team/people';
import { useRole } from '@/components/shell/role-context';
import { DcrFlow } from './dcr-flow';

/** One report, read-only, opened from the team list. Reuses DcrFlow's read-only view. */
export function TeamDcrDetail({ id }: { id: string }) {
  const { role } = useRole();
  const people = useTeamPeople(role);
  const q = useQuery({
    queryKey: ['dcr', id],
    queryFn: async () => {
      await apiReady();
      const r = await api.GET('/v1/dcrs/{id}', { params: { path: { id } } });
      if (!r.data) throw new Error(failureMessage(r, 'Could not load this report.'));
      return r.data;
    },
  });
  const d = q.data;
  return (
    <>
      <Link
        href="/dcr?tab=team"
        className="flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Team DCRs
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">
        {d
          ? `${people.data?.byId.get(d.userId)?.name ?? 'Team member'} · ${dateLabel(d.date)}`
          : 'Daily call report'}
      </h1>
      {q.error ? (
        <p role="alert" className="text-sm text-destructive">
          {(q.error as Error).message}
        </p>
      ) : !d ? (
        <Skeleton className="h-64" />
      ) : (
        <DcrFlow key={d.id} initialDate={d.date} dateLocked reportId={d.id} />
      )}
    </>
  );
}
