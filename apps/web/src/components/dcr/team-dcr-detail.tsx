'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import { dateLabel, timeIST } from '@/components/attendance/format';
import { money } from '@/lib/expenses/model';
import type { Dcr } from '@ariforce/contracts';
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
        <>
          <ReportFacts d={d} nameOf={(uid) => people.data?.byId.get(uid)?.name} />
          <DcrFlow key={d.id} initialDate={d.date} dateLocked reportId={d.id} viewOnly />
        </>
      )}
    </>
  );
}

const STATUS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Waiting for review',
  locked: 'Locked',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** Status, review and lock facts for someone else's report. Plain text, no actions. */
function ReportFacts({ d, nameOf }: { d: Dcr; nameOf: (id: string) => string | undefined }) {
  const who = (id?: string | null) => (id ? (nameOf(id) ?? 'Manager') : 'Manager');
  const at = (iso?: string | null) =>
    iso ? `${dateLabel(iso.slice(0, 10))}, ${timeIST(iso)}` : '';
  const rows: [string, string][] = [['Status', STATUS[d.status] ?? d.status]];
  if (d.submittedAt) rows.push(['Submitted', at(d.submittedAt)]);
  if (d.approvedAt)
    rows.push([
      'Approved',
      d.autoApproved || !d.approvedBy
        ? `Automatically, ${at(d.approvedAt)}`
        : `${who(d.approvedBy)}, ${at(d.approvedAt)}`,
    ]);
  if (d.rejectedAt) rows.push(['Rejected', `${who(d.rejectedBy)}, ${at(d.rejectedAt)}`]);
  if (d.rejectionReason) rows.push(['Reason', d.rejectionReason]);
  if (d.deviationReason) rows.push(['Change from tour plan', d.deviationReason]);
  if (d.neverLocks) rows.push(['Day lock', 'Never locks']);
  else if (d.lockAt) {
    const past = Date.parse(d.lockAt) <= Date.now();
    rows.push(['Day lock', `${past ? 'Locked' : 'Locks'} ${at(d.lockAt)}`]);
  }
  if (d.unlockedUntil && Date.parse(d.unlockedUntil) > Date.now())
    rows.push(['Open for correction until', at(d.unlockedUntil)]);
  if ((d.expenseCount ?? 0) > 0)
    rows.push([
      'Expenses',
      `${money(d.expenseTotal ?? 0)} · ${d.expenseCount} item${d.expenseCount === 1 ? '' : 's'}`,
    ]);
  return (
    <dl
      className="grid gap-x-6 gap-y-2 rounded-xl border border-border bg-card p-4 text-sm sm:grid-cols-[max-content_1fr]"
      data-testid="dcr-facts"
    >
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
