'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import { Input } from '@ariforce/ui/components/input';
import { API_URL, api } from '@/lib/api';
import { allPages } from '@/lib/paging';
import type { Role } from '@/lib/roles';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Slip = {
  company: string;
  name: string;
  designation: string | null;
  employeeCode: string | null;
  monthLabel: string;
  totalDays: number;
  paidDays: number;
  unpaidDays: number;
  absentDays: number;
  lopDays: number;
  basic: number;
  hra: number;
  special: number;
  gross: number;
  professionalTax: number;
  esi: number;
  bonusDeduction: number;
  deductions: number;
  net: number;
  hasStructure: boolean;
  ctc: number;
  joinedOn: string | null;
  department: string | null;
  branch: string | null;
  pfAccount: string | null;
  esiNumber: string | null;
  fixedBasic: number;
  fixedHra: number;
  fixedSpecial: number;
};

type Person = { id: string; name: string };

const inr = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

async function readSlip(year: number, month: number, userId?: string) {
  const q = new URLSearchParams({ year: String(year), month: String(month) });
  if (userId) q.set('userId', userId);
  const res = await fetch(`${API_URL}/v1/payslips?${q}`, { credentials: 'include' });
  const body = (await res.json()) as Slip & { message?: string; code?: string };
  if (!res.ok) throw new Error(body.message || 'Could not open the payslip.');
  return body;
}

export function PayslipDialog({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Role;
}) {
  const hr = role === 'hr' || role === 'system_admin' || role === 'director';
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [people, setPeople] = useState<Person[]>([]);
  const [userId, setUserId] = useState('');
  const [query, setQuery] = useState('');
  const [slip, setSlip] = useState<Slip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open || !hr) return;
    let live = true;
    void allPages<{ id: string; name: string }>((cursor) =>
      api.GET('/v1/users', { params: { query: { limit: 100, cursor } } }),
    ).then((r) => {
      if (!live || !r.data) return;
      setPeople(
        r.data.items
          .map((p) => ({ id: p.id, name: p.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    });
    return () => {
      live = false;
    };
  }, [open, hr]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setError(null);
    void readSlip(year, month, hr && userId ? userId : undefined)
      .then((next) => live && setSlip(next))
      .catch((e: Error) => {
        if (!live) return;
        setSlip(null);
        setError(e.message);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [open, year, month, userId, hr]);

  const matches = people.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const paidWidth = slip && slip.totalDays ? Math.round((slip.paidDays / slip.totalDays) * 100) : 0;

  async function download() {
    setDownloading(true);
    try {
      const q = new URLSearchParams({ year: String(year), month: String(month) });
      if (hr && userId) q.set('userId', userId);
      const res = await fetch(`${API_URL}/v1/payslips/file?${q}`, { credentials: 'include' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message || 'Could not download the payslip.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payslip-${year}-${String(month).padStart(2, '0')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Payslip</DialogTitle>
          <DialogDescription>
            Pick a month. A slip is available only when salary is loaded for that person.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm hover:bg-muted"
            onClick={() => setYear((y) => y - 1)}
          >
            {year - 1}
          </button>
          <p className="text-sm font-medium tabular-nums">{year}</p>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm hover:bg-muted"
            onClick={() => setYear((y) => y + 1)}
          >
            {year + 1}
          </button>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Month">
          {MONTHS.map((label, i) => {
            const value = i + 1;
            const on = month === value;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                className={`rounded-md px-2.5 py-1 text-sm ${on ? 'bg-foreground text-background' : 'hover:bg-muted'}`}
                onClick={() => setMonth(value)}
              >
                {label}
              </button>
            );
          })}
        </div>
        {hr && (
          <label className="flex flex-col gap-1 text-sm">
            Person
            <Input
              value={query}
              placeholder="Your slip, or type a name"
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <ul className="max-h-36 overflow-auto rounded-md border">
                {matches.slice(0, 8).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${userId === p.id ? 'bg-muted' : ''}`}
                      onClick={() => {
                        setUserId(p.id);
                        setQuery(p.name);
                      }}
                    >
                      {p.name}
                    </button>
                  </li>
                ))}
                {matches.length === 0 && (
                  <li className="px-3 py-2 text-sm text-muted-foreground">
                    No one with that name.
                  </li>
                )}
              </ul>
            )}
          </label>
        )}
        {loading && <p className="text-sm text-muted-foreground">Opening the month…</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {slip && !loading && (
          <article className="af-enter overflow-hidden rounded-xl border bg-background shadow-sm">
            <div className="flex items-center gap-3 border-b px-4 py-3">
              <img src="/ariforce-logo.png" alt="" className="h-9 w-auto" />
              <div>
                <p className="text-sm font-semibold">{slip.company}</p>
                <p className="text-xs text-muted-foreground">
                  Pay slip for the period of {slip.monthLabel}
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-3 text-xs">
              {(
                [
                  ['Name', slip.name],
                  ['Employee ID', slip.employeeCode || '—'],
                  ['Department', slip.department || '—'],
                  ['Designation', slip.designation || '—'],
                  ['Work location', slip.branch || '—'],
                  ['ESI number', slip.esiNumber || '—'],
                  ['Total days', String(slip.totalDays)],
                  ['Paid days', String(slip.paidDays)],
                  ['Unpaid days', String(slip.unpaidDays)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex gap-1">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="px-4">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
                  style={{ width: `${paidWidth}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {slip.absentDays} absent · {slip.lopDays} loss of pay
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 text-xs">
              <div>
                <p className="bg-foreground px-3 py-1.5 font-medium text-background">Earnings</p>
                <p className="grid grid-cols-[1fr_auto_auto] gap-2 bg-muted px-3 py-1 text-muted-foreground">
                  <span>Item</span>
                  <span>Fixed</span>
                  <span>Amount</span>
                </p>
                {(
                  [
                    ['Basic', slip.fixedBasic, slip.basic],
                    ['HRA', slip.fixedHra, slip.hra],
                    ['Special allowance', slip.fixedSpecial, slip.special],
                  ] as const
                ).map(([label, fixed, amount]) => (
                  <p
                    key={label}
                    className="grid grid-cols-[1fr_auto_auto] gap-2 border-b px-3 py-1"
                  >
                    <span>{label}</span>
                    <span className="tabular-nums">{inr(fixed)}</span>
                    <span className="tabular-nums">{inr(amount)}</span>
                  </p>
                ))}
                <p className="grid grid-cols-[1fr_auto] gap-2 bg-foreground px-3 py-1.5 font-medium text-background">
                  <span>Total earnings</span>
                  <span className="tabular-nums">{inr(slip.gross)}</span>
                </p>
              </div>
              <div className="border-l">
                <p className="bg-foreground px-3 py-1.5 font-medium text-background">Deductions</p>
                <p className="grid grid-cols-[1fr_auto] gap-2 bg-muted px-3 py-1 text-muted-foreground">
                  <span>Item</span>
                  <span>Amount</span>
                </p>
                {(
                  [
                    ['Professional tax', slip.professionalTax],
                    ['ESI', slip.esi],
                    ['Annual bonus', slip.bonusDeduction],
                  ] as const
                ).map(([label, amount]) => (
                  <p key={label} className="grid grid-cols-[1fr_auto] gap-2 border-b px-3 py-1">
                    <span>{label}</span>
                    <span className="tabular-nums">{inr(amount)}</span>
                  </p>
                ))}
                <p className="grid grid-cols-[1fr_auto] gap-2 bg-foreground px-3 py-1.5 font-medium text-background">
                  <span>Total deductions</span>
                  <span className="tabular-nums">{inr(slip.deductions)}</span>
                </p>
              </div>
            </div>
            <p className="flex items-baseline justify-between px-4 py-3">
              <span className="text-sm font-medium">Net earnings</span>
              <span className="text-xl font-semibold tabular-nums">{inr(slip.net)}</span>
            </p>
            <div className="px-4 pb-4">
              <Button type="button" disabled={downloading} onClick={() => void download()}>
                <Download />
                {downloading ? 'Preparing…' : 'Download PDF'}
              </Button>
            </div>
          </article>
        )}
      </DialogContent>
    </Dialog>
  );
}
