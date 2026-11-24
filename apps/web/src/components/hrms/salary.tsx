'use client';

import { useEffect, useState } from 'react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { api } from '@/lib/api';
import { allPages } from '@/lib/paging';

type Person = { id: string; name: string; ctc: number | null };

const inr = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** Half basic, 40% of that as HRA, and the remaining 30% as special allowance. */
function standardSplit(ctc: number) {
  return {
    basic: Math.round((ctc * 0.5) / 12),
    hra: Math.round((ctc * 0.2) / 12),
    special: Math.round((ctc * 0.3) / 12),
  };
}

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
  const [yearly, setYearly] = useState('');
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingStructure, setLoadingStructure] = useState(false);
  const [fromMonth, setFromMonth] = useState<string | null>(null);
  const [automatic, setAutomatic] = useState(false);

  useEffect(() => {
    void allPages<{ id: string; name: string; ctc?: number | null }>((cursor) =>
      api.GET('/v1/users', { params: { query: { limit: 100, cursor } } }),
    ).then((r) => {
      if (!r.data) return;
      setPeople(
        r.data.items
          .map((p) => ({ id: p.id, name: p.name, ctc: p.ctc ?? null }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    });
  }, [notice]);

  const selectedCtc = people.find((p) => p.id === userId)?.ctc ?? null;

  useEffect(() => {
    if (!userId) return;
    let live = true;
    setLoadingStructure(true);
    setError(null);
    const fillStandard = () => {
      if (selectedCtc == null) {
        setYearly('');
        setBasic('');
        setHra('');
        setSpecial('');
        setAutomatic(false);
        return;
      }
      const split = standardSplit(selectedCtc);
      setYearly(String(selectedCtc));
      setBasic(String(split.basic));
      setHra(String(split.hra));
      setSpecial(String(split.special));
      setTax('0');
      setBonus('0');
      setFromMonth(null);
      setAutomatic(true);
    };
    const q = new URLSearchParams({ userId, month });
    void fetch(`${window.location.origin}/v1/payslips/structure?${q}`, {
      credentials: 'include',
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as {
          message?: string;
          automatic?: boolean;
          ctc?: number | null;
          basicMonthly: number | null;
          hraMonthly: number | null;
          specialMonthly: number | null;
          professionalTaxMonthly: number | null;
          bonusDeductionMonthly: number | null;
          effectiveMonth: string | null;
        } | null;
        if (!live) return;
        if (!res.ok || !body || body.basicMonthly == null) {
          fillStandard();
          if (!res.ok && selectedCtc == null)
            setError(body?.message || 'Could not load the structure.');
          return;
        }
        setBasic(String(body.basicMonthly));
        setHra(body.hraMonthly == null ? '' : String(body.hraMonthly));
        setSpecial(body.specialMonthly == null ? '' : String(body.specialMonthly));
        setYearly(
          body.ctc != null
            ? String(body.ctc)
            : String(
                ((body.basicMonthly ?? 0) + (body.hraMonthly ?? 0) + (body.specialMonthly ?? 0)) *
                  12,
              ),
        );
        setTax(body.professionalTaxMonthly == null ? '0' : String(body.professionalTaxMonthly));
        setBonus(body.bonusDeductionMonthly == null ? '0' : String(body.bonusDeductionMonthly));
        setFromMonth(body.effectiveMonth);
        setAutomatic(body.automatic === true);
      })
      .catch(() => {
        if (live) fillStandard();
      })
      .finally(() => live && setLoadingStructure(false));
    return () => {
      live = false;
    };
  }, [userId, month, selectedCtc]);

  const matches = people.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = people.find((p) => p.id === userId);
  const gross = (Number(basic) || 0) + (Number(hra) || 0) + (Number(special) || 0);
  const esi = Math.round(gross * 0.0075);

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
        ctc: yearly.trim() && Number.isInteger(Number(yearly)) ? Number(yearly) : gross * 12,
      }),
    });
    const body = (await res.json()) as { message?: string; ctc?: number };
    setSaving(false);
    if (!res.ok) {
      setError(body.message || 'Could not save the structure.');
      return;
    }
    setFromMonth(month);
    setAutomatic(false);
    if (body.ctc != null) setYearly(String(body.ctc));
    setNotice(`Saved. Yearly cost to company is ${inr(body.ctc ?? gross * 12)}.`);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6">
      <div>
        <h1 className="text-lg font-semibold">Salary structure</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Type a yearly cost and basic, HRA and special allowance fill from it. Change a monthly
          line when that person should differ. A later month keeps the earlier slip.
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
          {fromMonth && fromMonth !== month && (
            <p className="sm:col-span-2 text-sm text-muted-foreground">
              These amounts are the structure from {fromMonth}. Saving writes a new one from {month}
              .
            </p>
          )}
          {!loadingStructure && automatic && (
            <p className="sm:col-span-2 text-sm text-muted-foreground">
              Filled from the yearly cost: half is basic, 40% of basic is HRA, and the rest is
              special allowance. Professional tax and the bonus deduction are the saved monthly
              amounts. ESI is 0.75% of this monthly gross.
            </p>
          )}
          {!loadingStructure && !automatic && fromMonth == null && (
            <p className="sm:col-span-2 text-sm text-muted-foreground">
              No yearly cost is loaded, so a payslip stays closed.
            </p>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Yearly cost to company
            <Input
              inputMode="numeric"
              value={yearly}
              onChange={(e) => {
                const value = e.target.value;
                setYearly(value);
                const amount = Number(value);
                if (!Number.isInteger(amount) || amount < 0) return;
                const split = standardSplit(amount);
                setBasic(String(split.basic));
                setHra(String(split.hra));
                setSpecial(String(split.special));
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            From month
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Basic, monthly
            <Input
              inputMode="numeric"
              value={basic}
              onChange={(e) => {
                setBasic(e.target.value);
                setYearly(
                  String(
                    ((Number(e.target.value) || 0) + (Number(hra) || 0) + (Number(special) || 0)) *
                      12,
                  ),
                );
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            HRA, monthly
            <Input
              inputMode="numeric"
              value={hra}
              onChange={(e) => {
                setHra(e.target.value);
                setYearly(
                  String(
                    ((Number(basic) || 0) +
                      (Number(e.target.value) || 0) +
                      (Number(special) || 0)) *
                      12,
                  ),
                );
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Special allowance, monthly
            <Input
              inputMode="numeric"
              value={special}
              onChange={(e) => {
                setSpecial(e.target.value);
                setYearly(
                  String(
                    ((Number(basic) || 0) + (Number(hra) || 0) + (Number(e.target.value) || 0)) *
                      12,
                  ),
                );
              }}
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
          <label className="flex flex-col gap-1 text-sm">
            ESI, monthly
            <Input readOnly tabIndex={-1} value={String(esi)} className="bg-muted" />
          </label>
          <p className="sm:col-span-2 text-sm text-muted-foreground">
            Monthly gross {inr(gross)}. ESI is calculated and is not edited. On a short month the
            slip uses 0.75% of the earned gross.
          </p>
          {error && (
            <p role="alert" className="sm:col-span-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && <p className="sm:col-span-2 text-sm">{notice}</p>}
          <Button type="submit" disabled={saving || loadingStructure || gross <= 0}>
            {saving ? 'Saving…' : 'Save structure'}
          </Button>
        </form>
      )}
    </div>
  );
}
