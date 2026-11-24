'use client';

import { useEffect, useState } from 'react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { api, toApiError } from '@/lib/api';
import { allPages } from '@/lib/paging';

type Claim = {
  id: string;
  userName: string;
  month: string;
  status: string;
  total: number;
  canPay?: boolean;
};

export function HrExpenses() {
  const [rows, setRows] = useState<Claim[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      const team = await allPages<Claim>((cursor) =>
        api.GET('/v1/expense-claims', {
          params: { query: { scope: 'team', limit: 100, cursor } },
        }),
      );
      const r = team.error
        ? await allPages<Claim>((cursor) =>
            api.GET('/v1/expense-claims', { params: { query: { limit: 100, cursor } } }),
          )
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
  }, [tick]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Expenses</h1>
      <p className="text-sm text-muted-foreground">
        Approved and paid claims. A role that can approve also sees every claim in the reporting
        line.
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
                <th className="px-3 py-2 font-medium">Payment</th>
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
                  <td className="px-3 py-2">
                    {c.canPay ? (
                      <Pay id={c.id} onPaid={() => setTick((n) => n + 1)} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-muted-foreground">
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

function Pay({ id, onPaid }: { id: string; onPaid: () => void }) {
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const paymentRef = ref.trim();
        if (!paymentRef || busy) return;
        setBusy(true);
        setError(null);
        void api
          .POST('/v1/expense-claims/{id}/pay', {
            params: { path: { id } },
            body: { paymentRef },
          })
          .then((r) => {
            if (r.error) {
              setError(toApiError(r).message || 'Could not mark this paid.');
              setBusy(false);
              return;
            }
            onPaid();
          });
      }}
    >
      <Input
        aria-label="Payment reference"
        placeholder="UTR / cheque no."
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        className="h-8 w-36"
      />
      <Button type="submit" size="sm" disabled={!ref.trim() || busy}>
        Mark paid
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </form>
  );
}
