'use client';

import { useEffect, useState } from 'react';
import { LeaveMaster } from '@/components/admin/leave-master';
import { api, toApiError } from '@/lib/api';

type Request = {
  id: string;
  userName: string;
  typeName: string;
  fromDate: string;
  toDate: string;
  days: number;
  status: string;
};

export function HrLeave() {
  const [rows, setRows] = useState<Request[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api.GET('/v1/leave/requests').then((r) => {
      if (!live) return;
      if (r.error || !r.data) {
        setError(toApiError(r).message || 'Could not load leave.');
        setRows([]);
        return;
      }
      setRows(r.data.items as Request[]);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Leave</h1>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {rows === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {rows && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Leave requests</caption>
            <thead className="border-b bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">From</th>
                <th className="px-3 py-2 font-medium">To</th>
                <th className="px-3 py-2 font-medium">Days</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{r.userName}</td>
                  <td className="px-3 py-2">{r.typeName}</td>
                  <td className="px-3 py-2">{r.fromDate}</td>
                  <td className="px-3 py-2">{r.toDate}</td>
                  <td className="px-3 py-2 tabular-nums">{r.days}</td>
                  <td className="px-3 py-2 capitalize">{r.status}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-muted-foreground">
                    No leave requests.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <h2 className="pt-2 text-lg font-semibold">Leave setup</h2>
      <p className="text-sm text-muted-foreground">
        Holidays and the number of days people get. Paid leave stays at zero until six months after
        the joining date. Loss of pay is unchanged.
      </p>
      <LeaveMaster />
    </div>
  );
}
