'use client';

import { useEffect, useState } from 'react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { api } from '@/lib/api';

type Person = { id: string; name: string; ctc: number | null };

const inr = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function SalaryRestructure() {
  const now = new Date();
  const [people, setPeople] = useState<Person[]>([]);
  const [query, setQuery] = useState('');
  const [userId, setUserId] = useState('');
  const [basic, setBasic] = useState('');
  const [hra, setHra] = useState('');
  const [special, setSpecial] = useState('');
  const [tax, setTax] = useState('0');
  const [bonus, setBonus] = useState('0');
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api.GET('/v1/users', { params: { query: { limit: 100 } } }).then((r) => {
      if (r.error || !r.data) return;
      setPeople(
        (r.data.items as Person[])
          .map((p) => ({ id: p.id, name: p.name, ctc: p.ctc ?? null }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    });
  }, [notice]);

  const matches = people.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = people.find((p) => p.id === userId);
  const gross = (Number(basic) || 0) + (Number(hra) || 0) + (Number(special) || 0);

  async function save() {
    if (!userId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const res = await fetch(`${window.location.origin}/v1/payslips/structure`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId,
        effectiveMonth: `${month}-01`,
        basicMonthly: Number(basic) || 0,
        hraMonthly: Number(hra) || 0,
        specialMonthly: Number(special) || 0,
        professionalTaxMonthly: Number(tax) || 0,
        bonusDeductionMonthly: Number(bonus) || 0,
      }),
    });
    const body = (await res.json()) as { message?: string; ctc?: number };
    setSaving(false);
    if (!res.ok) {
      setError(body.message || 'Could not save the structure.');
      return;
    }
    setNotice(`Saved. Yearly cost to company is ${inr(body.ctc ?? gross * 12)}.`);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6">
      <div>
        <h1 className="text-lg font-semibold">Salary structure</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Basic, HRA and special allowance are the monthly gross. Their yearly total is the cost to
          company. A payslip can be downloaded only after this is saved. A later month keeps the
          earlier slip.
        </p>
      </div>
      <label className="flex max-w-sm flex-col gap-1 text-sm">
        Person
        <Input value={query} placeholder="Name" onChange={(e) => setQuery(e.target.value)} />
      </label>
      <ul className="max-h-64 overflow-auto rounded-lg border">
        {matches.map((p) => (
          <li key={p.id} className="border-b last:border-0">
            <button
              type="button"
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted ${userId === p.id ? 'bg-muted' : ''}`}
              onClick={() => {
                setUserId(p.id);
                setQuery(p.name);
              }}
            >
              <span>{p.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {p.ctc == null ? 'Not loaded' : inr(p.ctc)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <form
          className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="sm:col-span-2 text-sm font-medium">{selected.name}</p>
          <label className="flex flex-col gap-1 text-sm">
            From month
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Basic, monthly
            <Input inputMode="numeric" value={basic} onChange={(e) => setBasic(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            HRA, monthly
            <Input inputMode="numeric" value={hra} onChange={(e) => setHra(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Special allowance, monthly
            <Input
              inputMode="numeric"
              value={special}
              onChange={(e) => setSpecial(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Professional tax, monthly
            <Input inputMode="numeric" value={tax} onChange={(e) => setTax(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Bonus deduction, monthly
            <Input inputMode="numeric" value={bonus} onChange={(e) => setBonus(e.target.value)} />
          </label>
          <p className="sm:col-span-2 text-sm text-muted-foreground">
            Monthly gross {inr(gross)}. Yearly cost to company {inr(gross * 12)}. ESI is 0.75% of
            the earned gross on the slip.
          </p>
          {error && (
            <p role="alert" className="sm:col-span-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && <p className="sm:col-span-2 text-sm">{notice}</p>}
          <Button type="submit" disabled={saving || gross <= 0}>
            {saving ? 'Saving…' : 'Save structure'}
          </Button>
        </form>
      )}
    </div>
  );
}
