/**
 * Home "Needs attention" from live data (replaces the mock's attention + approvals counts):
 *  - my open exceptions dcr_missing / tp_not_submitted (GET /v1/exceptions, field:read); a past
 *    missing day is locked (00:00 IST next day) and opens the day for an unlock request
 *  - my DCR drafts, my draft/rejected tour plans, my editable expense claims
 *  - approvers (isApprover): team DCRs, TPs, expenses, leave waiting for a decision
 *  - Directors: DCR unlock requests
 */
import type { Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import { useDraftList } from './dcr/api';
import { reviewOf, useTeamSubmitted, useUnlockQueue } from './dcr/adapter';
import { dateLabel, todayIST } from './dcr/dates';
import { isEditable, monthLabel, useClaimQueue, useMyClaims } from './expenses';
import { useLeaveQueue } from './leave';
import { isApprover, isDirector } from './roles';
import { rangeLabel, useMyTps, useTpQueue } from './tp/adapter';

export type Attention = {
  id: string;
  title: string;
  detail: string;
  severity: 'high' | 'medium' | 'info';
  href: Href;
};

type Exc = {
  id: string;
  ruleCode: string;
  periodDate: string;
  status: string;
  suggestedAction: string;
};

function useMyExceptions(myId: string | undefined) {
  return useQuery({
    queryKey: ['exceptions', 'me', myId],
    enabled: !!myId,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      apiFetch<{ items: Exc[] }>('/v1/exceptions', {
        signal,
        query: {
          userId: myId,
          status: 'open,acknowledged',
          ruleCode: 'dcr_missing,tp_not_submitted',
          limit: 50,
        },
      })
        .then((r) => r.items)
        // No field:read (403) or older API: no exception rows, the rest still shows.
        .catch(() => [] as Exc[]),
  });
}

export function useHomeAttention(
  user: { id: string; roles: readonly string[] } | null | undefined,
) {
  const myId = user?.id;
  const roles = user?.roles ?? [];
  const approver = isApprover(roles);
  const director = isDirector(roles);
  const today = todayIST();

  const exc = useMyExceptions(myId);
  const drafts = useDraftList();
  const tps = useMyTps(myId);
  const claims = useMyClaims(myId);
  const teamDcr = useTeamSubmitted(approver ? myId : undefined);
  const tpQ = useTpQueue(myId, approver);
  const expQ = useClaimQueue(myId, approver);
  const leaveQ = useLeaveQueue(myId, approver);
  const unlockQ = useUnlockQueue(director);

  const items: Attention[] = [];
  for (const e of exc.data ?? []) {
    if (e.ruleCode === 'dcr_missing') {
      const locked = e.periodDate < today;
      items.push({
        id: `exc-${e.id}`,
        title: locked ? `DCR missing · ${dateLabel(e.periodDate)}` : 'DCR due today',
        detail: locked ? 'Day is locked · request unlock to file it' : e.suggestedAction,
        severity: locked ? 'high' : 'medium',
        href: { pathname: '/dcr/form', params: { new: '1', date: e.periodDate } },
      });
    } else
      items.push({
        id: `exc-${e.id}`,
        title: 'Tour plan not submitted',
        detail: e.suggestedAction,
        severity: 'medium',
        href: '/tour-plan',
      });
  }
  for (const d of (drafts.data?.items ?? []).filter((x) => x.status === 'draft'))
    items.push({
      id: `dcr-${d.id}`,
      title: `DCR draft · ${dateLabel(d.date)}`,
      detail: 'Finish and submit',
      severity: 'medium',
      href: { pathname: '/dcr/form', params: { id: d.id } },
    });
  for (const t of (tps.data ?? []).filter((x) => x.status === 'draft' || x.status === 'rejected'))
    items.push({
      id: `tp-${t.id}`,
      title: `Tour plan ${t.status === 'rejected' ? 'rejected' : 'draft'} · ${rangeLabel(t.from, t.to)}`,
      detail:
        t.status === 'rejected' ? (t.rejectionReason ?? 'Fix and send again') : 'Send for approval',
      severity: t.status === 'rejected' ? 'high' : 'medium',
      href: { pathname: '/tour-plan/form', params: { id: t.id } },
    });
  for (const c of (claims.data ?? []).filter((x) => isEditable(x.status) && x.lineCount > 0))
    items.push({
      id: `exp-${c.id}`,
      title: `Expense ${c.status === 'rejected' ? 'sent back' : 'draft'} · ${monthLabel(c.month)}`,
      detail:
        c.status === 'rejected' ? (c.rejectionReason ?? 'Fix and resubmit') : 'Review and submit',
      severity: c.status === 'rejected' ? 'high' : 'info',
      href: { pathname: '/expenses/[id]', params: { id: c.id } },
    });

  const pendingDcr = (teamDcr.data ?? []).filter((d) => reviewOf(d).status === 'submitted').length;
  const counts = {
    dcr: pendingDcr,
    tourPlans: tpQ.data?.length ?? 0,
    leave: leaveQ.data?.length ?? 0,
    expenses: expQ.data?.length ?? 0,
    unlock: unlockQ.data?.length ?? 0,
  };
  if (approver) {
    const waiting = counts.dcr + counts.tourPlans + counts.leave + counts.expenses;
    if (waiting)
      items.push({
        id: 'approvals',
        title: `${waiting} waiting for your approval`,
        detail: [
          counts.dcr && `${counts.dcr} DCR`,
          counts.tourPlans && `${counts.tourPlans} tour plan`,
          counts.expenses && `${counts.expenses} expense`,
          counts.leave && `${counts.leave} leave`,
        ]
          .filter(Boolean)
          .join(' · '),
        severity: 'medium',
        href: '/approvals',
      });
  }
  if (director && counts.unlock)
    items.push({
      id: 'unlock',
      title: `${counts.unlock} unlock ${counts.unlock === 1 ? 'request' : 'requests'}`,
      detail: 'Reps asking to reopen a locked DCR day',
      severity: 'medium',
      href: '/approvals',
    });

  const rank = { high: 0, medium: 1, info: 2 } as const;
  items.sort((a, b) => rank[a.severity] - rank[b.severity]);

  const pending =
    exc.isPending ||
    drafts.isPending ||
    tps.isPending ||
    claims.isPending ||
    (approver && (teamDcr.isPending || tpQ.isPending || expQ.isPending || leaveQ.isPending));
  const refetch = () =>
    Promise.all([
      exc.refetch(),
      drafts.refetch(),
      tps.refetch(),
      claims.refetch(),
      approver
        ? Promise.all([teamDcr.refetch(), tpQ.refetch(), expQ.refetch(), leaveQ.refetch()])
        : null,
      director ? unlockQ.refetch() : null,
    ]);
  return { items, counts, pending, refetch };
}
