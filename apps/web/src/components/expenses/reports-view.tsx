'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileDown, LoaderCircle } from 'lucide-react';
import { EXPENSE_CATEGORIES, EXPENSE_STATUSES, type ExpenseStatus } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ariforce/ui/components/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@ariforce/ui/components/table';
import { toast } from '@ariforce/ui/components/sonner';
import { api, apiReady, toApiError } from '@/lib/api';
import { can, CATEGORY_LABEL, messageFor, quietAbort, money, monthLabel, selfId, STATUS_LABEL, thisMonth } from '@/lib/expenses/model';
import { useRole } from '@/components/shell/role-context';
import { StatusBadge } from './status-badge';

type Report = { month: string; total: number; byCategory: Record<string, number>; rows: { userId: string; userName: string; status: ExpenseStatus; total: number; claimedDays: number; dcrDays: number; matchedDays: number; unmatchedAmount: number }[] };

/** Monthly expense report with Excel/PDF export. Approvers see their team; finance sees everyone the API returns. */
export function ReportsView() {
  const { role, user } = useRole();
  const finance = can(role, 'finance:read');
  const [month, setMonth] = useState(thisMonth());
  const [status, setStatus] = useState<ExpenseStatus | 'all'>('all');
  const [scope, setScope] = useState<'all' | 'team'>(finance ? 'all' : 'team');
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);

  const query = useCallback(async () => {
    const me = scope === 'team' ? await selfId(role, user) : null;
    return { month, ...(status === 'all' ? {} : { status }), ...(me ? { teamOf: me } : {}) };
  }, [month, status, scope, role, user]);

  useEffect(() => {
    if (!month) return;
    const ac = new AbortController();
    setData(null);
    setError(null);
    quietAbort(ac.signal, (async () => {
      await apiReady();
      const r = await api.GET('/v1/expense-reports', { params: { query: await query() }, signal: ac.signal });
      if (ac.signal.aborted) return;
      if (r.error || !r.data) setError(messageFor(toApiError(r)));
      else setData(r.data);
    })());
    return () => ac.abort();
  }, [month, query]);

  async function download(format: 'xlsx' | 'pdf') {
    setExporting(format);
    const r = await api.GET('/v1/expense-reports/export', { params: { query: { ...(await query()), format } }, parseAs: 'blob' });
    setExporting(null);
    if (r.error || !r.data) return toast.error(messageFor(toApiError(r)));
    const url = URL.createObjectURL(r.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses-${month}.${format}`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rep-month">Month</Label>
          <Input id="rep-month" type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} className="w-44" data-testid="rep-month" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rep-status">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as ExpenseStatus | 'all')}>
            <SelectTrigger id="rep-status" className="w-48" data-testid="rep-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {EXPENSE_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {can(role, 'expenses:approve') && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rep-scope">People</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as 'all' | 'team')}>
              <SelectTrigger id="rep-scope" className="w-40" data-testid="rep-scope"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="team">My team</SelectItem>
                <SelectItem value="all">Everyone I can see</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="ml-auto flex gap-2">
          {(['xlsx', 'pdf'] as const).map((f) => (
            <Button key={f} variant="outline" disabled={!!exporting || !data} onClick={() => download(f)} data-testid={`rep-export-${f}`}>
              {exporting === f ? <LoaderCircle className="animate-spin" aria-hidden /> : <FileDown aria-hidden />}
              {f === 'xlsx' ? 'Excel' : 'PDF'}
            </Button>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900" data-testid="rep-error">{error}</p>
      ) : !data ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted/60" aria-busy="true" />
      ) : data.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground" data-testid="rep-empty">No claims for {monthLabel(data.month)}.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-6" data-testid="rep-categories">
            <div className="rounded-lg border p-2"><dt className="text-xs text-muted-foreground">Total</dt><dd className="text-sm font-semibold tabular-nums" data-testid="rep-total">{money(data.total)}</dd></div>
            {EXPENSE_CATEGORIES.map((c) => (
              <div key={c} className="rounded-lg border p-2"><dt className="text-xs text-muted-foreground">{CATEGORY_LABEL[c]}</dt><dd className="text-sm font-semibold tabular-nums">{money(data.byCategory[c] ?? 0)}</dd></div>
            ))}
          </dl>
          <Table data-testid="rep-table">
            <TableHeader>
              <TableRow><TableHead>Person</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Days / DCR</TableHead><TableHead className="text-right">Flagged</TableHead><TableHead className="text-right">Total</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.userId} data-testid="rep-row">
                  <TableCell className="font-medium">{r.userName}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{r.claimedDays} / {r.dcrDays}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.unmatchedAmount ? money(r.unmatchedAmount) : '–'}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter><TableRow><TableCell colSpan={4}>Total</TableCell><TableCell className="text-right tabular-nums">{money(data.total)}</TableCell></TableRow></TableFooter>
          </Table>
        </>
      )}
    </div>
  );
}
