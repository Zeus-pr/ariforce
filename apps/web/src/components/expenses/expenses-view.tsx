'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronRight, FileSpreadsheet, Plus } from 'lucide-react';
import { EXPENSE_STATUSES, type ExpenseCategory, type ExpenseStatus } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { toast } from '@ariforce/ui/components/sonner';
import { cn } from '@ariforce/ui/lib/utils';
import { api, apiReady, toApiError } from '@/lib/api';
import { canPayExpenses } from '@/lib/permissions';
import {
  can,
  CATEGORY_LABEL,
  messageFor,
  quietAbort,
  money,
  monthLabel,
  selfId,
  STATUS_LABEL,
  thisMonth,
} from '@/lib/expenses/model';
import { useRole } from '@/components/shell/role-context';
import { StatusBadge } from './status-badge';
import { TrailDots, type TrailClaim } from './approval-trail';
import { ExpenseFlow } from './expense-flow';

type Summary = TrailClaim & {
  id: string;
  userId: string;
  userName: string;
  month: string;
  status: ExpenseStatus;
  total: number;
  lineCount: number;
};
type Scope = 'mine' | 'team' | 'pay';
type Recon = {
  byCategory: Partial<Record<ExpenseCategory, number>>;
  days: { dcrStatus: string | null }[];
};

export function ExpensesView() {
  const { role, user } = useRole();
  const router = useRouter();
  const mayWrite = can(role, 'expenses:write');
  const mayApprove = can(role, 'expenses:approve');
  const mayPay = canPayExpenses(role);
  const scopes: { id: Scope; label: string }[] = [
    ...(mayWrite ? [{ id: 'mine' as const, label: 'My expenses' }] : []),
    ...(mayApprove ? [{ id: 'team' as const, label: 'To approve' }] : []),
    ...(mayPay || can(role, 'finance:read') ? [{ id: 'pay' as const, label: 'To pay' }] : []),
  ];
  const [scope, setScope] = useState<Scope>(scopes[0]?.id ?? 'mine');
  const [month, setMonth] = useState('');
  const [status, setStatus] = useState<ExpenseStatus | 'all'>('all');
  const [rows, setRows] = useState<Summary[] | null>(null);
  const [recon, setRecon] = useState<Record<string, Recon>>({});
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setRows(null);
      setError(null);
      void tick;
      await apiReady();
      const me = await selfId(role, user);
      const st =
        scope === 'pay'
          ? 'approved'
          : scope === 'team' && status === 'all'
            ? 'submitted'
            : status === 'all'
              ? undefined
              : status;
      const r = await api.GET('/v1/expense-claims', {
        params: {
          query: {
            ...(month ? { month } : {}),
            ...(st ? { status: st } : {}),
            ...(scope === 'mine' && me ? { userId: me } : {}),
          },
        },
        signal,
      });
      if (signal.aborted) return;
      if (r.error || !r.data) return setError(messageFor(toApiError(r)));
      const items = (r.data.items as Summary[]).sort((a, b) => b.month.localeCompare(a.month));
      const list = scope === 'mine' ? items : items.filter((c) => c.userId !== me);
      setRows(list);
      // Approver queue: category totals and DCR status per claim.
      if (scope !== 'mine') {
        const out: Record<string, Recon> = {};
        await Promise.all(
          list.slice(0, 30).map(async (c) => {
            const x = await api.GET('/v1/expense-claims/{id}/reconciliation', {
              params: { path: { id: c.id } },
              signal,
            });
            if (x.data) out[c.id] = x.data as Recon;
          }),
        );
        if (!signal.aborted) setRecon(out);
      }
    },
    // tick: retry after an error
    [month, status, scope, role, user, tick],
  );
  useEffect(() => {
    const ac = new AbortController();
    quietAbort(ac.signal, load(ac.signal));
    return () => ac.abort();
  }, [load]);

  const attention = useMemo(
    () =>
      scope === 'mine'
        ? (rows ?? []).filter((c) => c.status === 'draft' || c.status === 'rejected')
        : [],
    [rows, scope],
  );
  const total = (rows ?? []).reduce((s, c) => s + c.total, 0);
  const chips: (ExpenseStatus | 'all')[] =
    scope === 'pay'
      ? []
      : ['all', ...EXPENSE_STATUSES.filter((s) => scope !== 'team' || s !== 'draft')];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {scopes.length > 1 ? (
          <div
            role="tablist"
            aria-label="Which expenses"
            className="inline-flex rounded-lg border bg-muted/40 p-0.5"
            data-testid="exp-scopes"
          >
            {scopes.map((s) => (
              <button
                key={s.id}
                role="tab"
                type="button"
                aria-selected={scope === s.id}
                onClick={() => {
                  setScope(s.id);
                  setStatus('all');
                }}
                data-testid={`exp-scope-${s.id}`}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm"
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/expenses/reports" data-testid="exp-reports-link">
              <FileSpreadsheet aria-hidden /> Reports
            </Link>
          </Button>
          {mayWrite && (
            <Button
              className="bg-brand-600 hover:bg-brand-700"
              onClick={() => setCreating(true)}
              data-testid="exp-new"
            >
              <Plus aria-hidden /> New expense
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {chips.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            aria-pressed={status === s}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              status === s
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'bg-background text-muted-foreground hover:text-foreground',
            )}
            data-testid={`exp-chip-${s}`}
          >
            {s === 'all' ? (scope === 'team' ? 'Waiting' : 'All') : STATUS_LABEL[s]}
          </button>
        ))}
        <Input
          type="month"
          value={month}
          max={thisMonth()}
          onChange={(e) => setMonth(e.target.value)}
          className="ml-auto h-8 w-40"
          aria-label="Month"
          data-testid="exp-month"
        />
      </div>

      {attention.length > 0 && status === 'all' && (
        <Link
          href={`/expenses/${attention[0]!.id}`}
          className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100"
          data-testid="exp-attention"
        >
          <AlertCircle className="size-5 shrink-0" aria-hidden />
          <span className="flex-1">
            <b>Needs attention:</b>{' '}
            {attention
              .map(
                (c) =>
                  `${monthLabel(c.month)} (${c.status === 'rejected' ? 'rejected' : 'not submitted'})`,
              )
              .join(', ')}
          </span>
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      )}

      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          data-testid="exp-error"
        >
          {error}
          <Button size="sm" variant="outline" onClick={() => setTick((t) => t + 1)}>
            Try again
          </Button>
        </div>
      ) : rows === null ? (
        <div className="flex flex-col gap-2" aria-busy="true" data-testid="exp-loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/60" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-sm text-muted-foreground"
          data-testid="exp-empty"
        >
          {scope === 'mine'
            ? 'No expenses yet.'
            : scope === 'team'
              ? 'Nothing to approve.'
              : 'Nothing to pay.'}
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2" data-testid="exp-list">
            {rows.map((c) => {
              const rc = recon[c.id];
              const notApproved = rc?.days.filter((d) => d.dcrStatus !== 'approved').length ?? 0;
              return (
                <li key={c.id}>
                  <Link
                    href={`/expenses/${c.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-background px-4 py-3 transition-colors hover:border-teal-300 hover:bg-teal-50/40 focus-visible:ring-[3px] focus-visible:ring-teal-200 focus-visible:outline-none"
                    data-testid="exp-row"
                    data-status={c.status}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {scope === 'mine' ? monthLabel(c.month) : c.userName}
                      </p>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {scope !== 'mine' && <span>{monthLabel(c.month)}</span>}
                        <span>
                          {c.lineCount} {c.lineCount === 1 ? 'expense' : 'expenses'}
                        </span>
                        {c.status !== 'draft' && <TrailDots claim={c} />}
                      </p>
                      {rc && (
                        <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
                          {Object.entries(rc.byCategory)
                            .filter(([, v]) => v)
                            .map(([k, v]) => (
                              <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5">
                                {CATEGORY_LABEL[k as ExpenseCategory]} {money(v!)}
                              </span>
                            ))}
                          <span
                            className={cn(
                              'rounded px-1.5 py-0.5',
                              notApproved
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-emerald-50 text-emerald-700',
                            )}
                          >
                            {notApproved
                              ? `${notApproved} day(s) DCR not approved`
                              : 'DCRs approved'}
                          </span>
                        </p>
                      )}
                    </div>
                    <span className="font-semibold tabular-nums">{money(c.total)}</span>
                    <StatusBadge status={c.status} />
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="text-right text-sm text-muted-foreground" data-testid="exp-sum">
            Total <span className="font-semibold text-foreground tabular-nums">{money(total)}</span>
          </p>
        </>
      )}

      <ExpenseFlow
        open={creating}
        claim={null}
        line={null}
        onClose={() => setCreating(false)}
        onSaved={(id, submitted) => {
          toast.success(submitted ? 'Submitted for approval' : 'Saved as draft');
          router.push(`/expenses/${id}`);
        }}
      />
    </div>
  );
}
