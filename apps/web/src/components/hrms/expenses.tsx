'use client';

import { useEffect, useState } from 'react';
import { api, toApiError } from '@/lib/api';

type Claim = {
  id: string;
  userName: string;
  month: string;
  status: string;
  total: number;
};

export function HrExpenses() {
  const [rows, setRows] = useState<Claim[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const team = await api.GET('/v1/expense-claims', {
        params: { query: { scope: 'team', limit: 100 } },
      });
      const r = team.error
        ? await api.GET('/v1/expense-claims', { params: { query: { limit: 100 } } })
        : team;
      if (!live) return;
      if (r.error || !r.data) {
        setError(toApiError(r).message || 'Could not load expenses.');
        setRows([]);
        return;
      }
      setRows(r.data.items as Claim[]);
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Expenses</h1>
      <p className="text-sm text-muted-foreground">
        Month claims, including the allowance written when a DCR is submitted.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {rows === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {rows && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Expense claims</caption>
            <thead className="border-b bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Month</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{c.userName}</td>
                  <td className="px-3 py-2">{c.month.slice(0, 7)}</td>
                  <td className="px-3 py-2 capitalize">{c.status}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.total.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-muted-foreground">
                    No claims you can see.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
