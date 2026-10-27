'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, LoaderCircle, Plus } from 'lucide-react';
import { EXPENSE_STATUSES, type ExpenseStatus } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ariforce/ui/components/select';
import { toast } from '@ariforce/ui/components/sonner';
import { api, apiReady, toApiError } from '@/lib/api';
import { canPayExpenses } from '@/lib/permissions';
import { can, messageFor, quietAbort, money, monthLabel, selfId, STATUS_LABEL, thisMonth } from '@/lib/expenses/model';
import { useRole } from '@/components/shell/role-context';
import { StatusBadge } from './status-badge';

type Summary = {
  id: string;
  userId: string;
  userName: string;
  month: string;
  status: ExpenseStatus;
  total: number;
  lineCount: number;
};
type Scope = 'mine' | 'team' | 'pay';

export function ExpensesView() {
  const { role, user } = useRole();
  const router = useRouter();
  const mayWrite = can(role, 'expenses:write');
  const mayApprove = can(role, 'expenses:approve');
  const mayPay = canPayExpenses(role);
  const scopes: { id: Scope; label: string }[] = [
    ...(mayWrite ? [{ id: 'mine' as const, label: 'My claims' }] : []),
    ...(mayApprove ? [{ id: 'team' as const, label: 'Team' }] : []),
    ...(mayPay || can(role, 'finance:read') ? [{ id: 'pay' as const, label: 'To pay' }] : []),
  ];
  const [scope, setScope] = useState<Scope>(scopes[0]?.id ?? 'mine');
  const [month, setMonth] = useState(thisMonth());
  const [status, setStatus] = useState<ExpenseStatus | 'all'>('all');
  const [rows, setRows] = useState<Summary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setRows(null);
      setError(null);
      await apiReady();
      const me = await selfId(role, user);
      // Server-side filters: month and status ("To pay" is approved claims); the API has no paging (CONTRACT-GAPS #25).
      const st = scope === 'pay' ? 'approved' : status === 'all' ? undefined : status;
      const r = await api.GET('/v1/expense-claims', {
        params: { query: { ...(month ? { month } : {}), ...(st ? { status: st } : {}), ...(scope === 'mine' && me ? { userId: me } : {}) } },
        signal,
      });
      if (signal.aborted) return;
      if (r.error || !r.data) return setError(messageFor(toApiError(r)));
      const items = r.data.items as Summary[];
      setRows(scope === 'team' ? items.filter((c) => c.userId !== me) : items);
    },
    [month, status, scope, role, user],
  );
  useEffect(() => {
    const ac = new AbortController();
    quietAbort(ac.signal, load(ac.signal));
    return () => ac.abort();
  }, [load]);

  async function openMonth() {
    setCreating(true);
    const r = await api.POST('/v1/expense-claims', { body: { month: month || thisMonth() } });
    setCreating(false);
    if (r.error || !r.data) return toast.error(messageFor(toApiError(r)));
    router.push(`/expenses/${r.data.id}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {scopes.length > 1 && (
          <div role="tablist" aria-label="Which claims" className="inline-flex rounded-lg border bg-muted/40 p-0.5" data-testid="exp-scopes">
            {scopes.map((s) => (
              <button
                key={s.id}
                role="tab"
                type="button"
                aria-selected={scope === s.id}
                onClick={() => setScope(s.id)}
                data-testid={`exp-scope-${s.id}`}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/expenses/reports" data-testid="exp-reports-link"><FileSpreadsheet aria-hidden /> Reports</Link>
          </Button>
          {mayWrite && scope === 'mine' && (
            <Button onClick={openMonth} disabled={creating} data-testid="exp-open-month">
              {creating ? <LoaderCircle className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
              {month ? `Claim for ${monthLabel(month)}` : 'New claim'}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="exp-month">Month</Label>
          <Input id="exp-month" type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} className="w-44" data-testid="exp-month" />
        </div>
        {scope !== 'pay' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-status-filter">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ExpenseStatus | 'all')}>
              <SelectTrigger id="exp-status-filter" className="w-48" data-testid="exp-status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {EXPENSE_STATUSES.filter((s) => scope !== 'team' || s !== 'draft').map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900" data-testid="exp-error">
          {error}
          <Button size="sm" variant="outline" onClick={() => void load(new AbortController().signal)}>Try again</Button>
        </div>
      ) : rows === null ? (
        <div className="flex flex-col gap-2" aria-busy="true" data-testid="exp-loading">
          {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/60" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground" data-testid="exp-empty">
          {scope === 'mine'
            ? `No claim for ${month ? monthLabel(month) : 'this filter'} yet.`
            : scope === 'team'
              ? 'No team claims match this filter.'
              : 'No approved claims waiting for payment.'}
        </div>
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="exp-list">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/expenses/${c.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none" data-testid="exp-row">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{scope === 'mine' ? monthLabel(c.month) : c.userName}</p>
                  <p className="text-xs text-muted-foreground">
                    {scope === 'mine' ? '' : `${monthLabel(c.month)} · `}
                    {c.lineCount} {c.lineCount === 1 ? 'line' : 'lines'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold tabular-nums">{money(c.total)}</span>
                  <StatusBadge status={c.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
