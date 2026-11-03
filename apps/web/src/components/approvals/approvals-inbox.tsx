'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Approval } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import { toast } from '@ariforce/ui/components/sonner';
import { cn } from '@ariforce/ui/lib/utils';
import { todayIST } from '@/components/attendance/format';
import { useRole } from '@/components/shell/role-context';
import { api, apiReady } from '@/lib/api';
import { failureMessage, thrownMessage } from '@/lib/dcr/errors';
import { decideTourPlanItem, fetchPendingTourPlanItems, type TpItem } from '@/lib/tour-plans/items';
import { addDays } from '@/lib/team/range';
import { ApprovalLine } from './approval-line';
import { InboxRow } from './inbox-row';
import { RejectDialog } from './reject-dialog';

const TourPlanItemEditor = dynamic(
  () => import('@/components/tour-plans/tour-plan-item-editor').then((m) => m.TourPlanItemEditor),
  { ssr: false },
);

type Entry =
  | { kind: 'approval'; key: string; type: string; at: string; approval: Approval }
  | { kind: 'tour'; key: string; type: string; at: string; item: TpItem; workType: string };

const TYPE_LABEL: Record<string, string> = {
  tour_plan: 'Tour plans',
  dcr: 'Daily reports',
  signup: 'Sign-ups',
  leave: 'Leave',
  expense: 'Expenses',
  dcr_unlock: 'DCR unlock',
};
const PERIODS = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Last 7 days' },
] as const;
type Period = (typeof PERIODS)[number]['key'];

const istDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
const dayOf = (iso: string) => istDay.format(new Date(iso));
const rangeLabel = (from: string, to: string) => {
  const f = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  return from === to ? f(from) : `${f(from)} – ${f(to)}`;
};

/** Everything waiting on the caller in one list: requests, tour plan days, daily reports, sign-ups. */
export function ApprovalsInbox() {
  const { user } = useRole();
  const [type, setType] = useState('all');
  const [period, setPeriod] = useState<Period>('all');
  const [rejecting, setRejecting] = useState<TpItem | null>(null);
  const [viewing, setViewing] = useState<TpItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['approvals-org', 'inbox', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<Entry[]> => {
      await apiReady();
      const [mine, org, tours, workTypes] = await Promise.all([
        api.GET('/v1/approvals', {
          params: { query: { status: 'pending', mine: 'to_decide', limit: 100 } },
        }),
        api.GET('/v1/approvals', {
          params: { query: { scope: 'org', include: 'dcr,signup', status: 'pending', limit: 100 } },
        }),
        fetchPendingTourPlanItems(user!.id),
        api.GET('/v1/work-types', { params: { query: { limit: 100 } } }),
      ]);
      if (!mine.data) throw new Error(failureMessage(mine, 'Could not load approvals.'));
      const names = new Map((workTypes.data?.items ?? []).map((w) => [w.id, w.name]));
      const reviews = ((org.data?.items ?? []) as Approval[]).filter(
        (a) => (a.subjectType === 'dcr' || a.subjectType === 'signup') && a.canDecide !== false,
      );
      const approvals = (mine.data.items as Approval[]).filter(
        (a) => a.subjectType !== 'dcr' && a.subjectType !== 'signup',
      );
      return [
        ...[...approvals, ...reviews].map((a): Entry => ({
          kind: 'approval',
          key: a.id,
          type: a.subjectType,
          at: a.createdAt,
          approval: a,
        })),
        ...tours.map((item): Entry => ({
          kind: 'tour',
          key: item.id,
          type: 'tour_plan',
          at: item.submittedAt ?? item.createdAt,
          item,
          workType: names.get(item.plan.workTypeId) ?? 'Tour plan',
        })),
      ].sort((a, b) => b.at.localeCompare(a.at));
    },
  });

  const today = todayIST();
  const since = period === 'today' ? today : period === 'week' ? addDays(today, -6) : null;
  const inPeriod = (e: Entry) => !since || dayOf(e.at) >= since;
  const all = (q.data ?? []).filter(inPeriod);
  const rows = all.filter((e) => type === 'all' || e.type === type);
  const counts = new Map<string, number>();
  for (const e of all) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);

  async function decideTour(item: TpItem, decision: 'approve' | 'reject', comment?: string) {
    if (busy) return;
    setBusy(item.id);
    try {
      await decideTourPlanItem(item.id, decision, comment);
      toast.success(
        decision === 'approve'
          ? `${item.userName}'s tour plan approved.`
          : 'Tour plan returned for changes.',
      );
      setRejecting(null);
      await q.refetch();
    } catch (cause) {
      toast.error(thrownMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-3 py-1 text-sm transition-colors',
      active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
    );

  return (
    <div className="flex flex-col gap-3" data-testid="approvals-inbox">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Type">
          <button type="button" className={chip(type === 'all')} onClick={() => setType('all')}>
            All · {all.length}
          </button>
          {[...counts].map(([t, n]) => (
            <button
              key={t}
              type="button"
              className={chip(type === t)}
              onClick={() => setType(type === t ? 'all' : t)}
            >
              {TYPE_LABEL[t] ?? t} · {n}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={period === p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                'rounded-md px-3 py-1 text-sm',
                period === p.key ? 'bg-background shadow-xs' : 'text-muted-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {q.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-danger-soft p-3 text-sm"
        >
          <span>{(q.error as Error).message}</span>
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
            Retry
          </Button>
        </div>
      ) : !q.data ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          Nothing waiting{period === 'today' ? ' from today' : ''}.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card" data-testid="inbox-list">
          {rows.map((e) =>
            e.kind === 'approval' ? (
              <ApprovalLine
                key={e.key}
                approval={e.approval}
                decidable
                meta={`Submitted ${rangeLabel(dayOf(e.at), dayOf(e.at))}`}
                onDone={() => void q.refetch()}
              />
            ) : (
              <InboxRow
                key={e.key}
                name={e.item.userName}
                badge="Tour plan"
                summary={`${e.workType} · ${rangeLabel(e.item.from, e.item.to)}`}
                meta={
                  e.item.rejectionReason
                    ? `Previously returned: ${e.item.rejectionReason}`
                    : `Submitted ${rangeLabel(dayOf(e.at), dayOf(e.at))}`
                }
                actions={
                  <>
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void decideTour(e.item, 'approve')}
                    >
                      {busy === e.item.id ? 'Saving…' : 'Approve'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => setRejecting(e.item)}
                    >
                      Reject
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setViewing(e.item)}>
                      View full plan
                    </Button>
                  </>
                }
              />
            ),
          )}
        </ul>
      )}

      <RejectDialog
        open={rejecting !== null}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={`Reject ${rejecting?.userName ?? ''}'s tour plan`}
        description="The submitter will see this reason and can update and resubmit the plan."
        onConfirm={(reason) => rejecting && void decideTour(rejecting, 'reject', reason)}
      />
      <TourPlanItemEditor
        date={viewing?.from ?? null}
        item={viewing}
        readOnly
        onClose={() => setViewing(null)}
        onSaved={() => {}}
      />
    </div>
  );
}
