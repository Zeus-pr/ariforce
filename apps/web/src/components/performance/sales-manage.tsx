'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { productBrand } from '@ariforce/contracts';
import { api, apiReady, toApiError } from '@/lib/api';
import { allPages } from '@/lib/paging';
import { monthLabel } from '@/lib/period';
import { inr } from './perf-ui';

type Kind = 'primary' | 'secondary';
type Hq = { id: string; name: string; code: string | null };
type Product = { id: string; name: string; code: string; brand: string | null };
type Target = {
  id: string;
  territoryId: string;
  territoryName: string;
  territoryCode: string;
  month: string;
  kind: Kind;
  brand: string | null;
  value: number;
};

const field = 'h-9 rounded-md border bg-background px-2 text-sm';
const box = 'flex flex-col gap-3 rounded-lg border p-4';
const thisMonth = () => new Date().toISOString().slice(0, 7);

async function call<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || !data) throw new Error(toApiError(error).message);
  return data;
}

function useHqs() {
  const [hqs, setHqs] = useState<Hq[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    void (async () => {
      await apiReady();
      const h = await api.GET('/v1/sfc/hqs');
      setHqs((h.data?.items ?? []).map((x) => ({ id: x.id, name: x.name, code: x.code })));
      const p = await allPages((cursor) =>
        api.GET('/v1/products', { params: { query: { limit: 200, cursor } } }),
      );
      setProducts(
        (p.data?.items ?? [])
          .filter((x) => !x.deletedAt)
          .map((x) => ({ id: x.id, name: x.name, code: x.code, brand: x.brand })),
      );
    })();
  }, []);
  return { hqs, products };
}

export function SalesManage({ onChanged }: { onChanged: () => void }) {
  const { hqs, products } = useHqs();
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="sales-manage">
      <TargetsPanel scope="hq" hqs={hqs} products={products} onChanged={onChanged} />
      <TargetsPanel scope="brand" hqs={hqs} products={products} onChanged={onChanged} />
    </div>
  );
}

function TargetsPanel({
  scope,
  hqs,
  products,
  onChanged,
}: {
  scope: 'hq' | 'brand';
  hqs: Hq[];
  products: Product[];
  onChanged: () => void;
}) {
  const [hq, setHq] = useState('');
  const [brand, setBrand] = useState('');
  const [kind, setKind] = useState<Kind>('primary');
  const [from, setFrom] = useState(thisMonth());
  const [to, setTo] = useState(thisMonth());
  const [value, setValue] = useState('');
  const [spread, setSpread] = useState<'each' | 'total'>('each');
  const [rows, setRows] = useState<Target[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const brands = useMemo(() => {
    const names = new Map<string, string>();
    for (const product of products) {
      const name = productBrand(product);
      if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const load = useCallback(async () => {
    await apiReady();
    const d = await call(
      api.GET('/v1/sales/targets', {
        params: { query: { from, to, ...(hq ? { territoryId: hq } : {}) } },
      }),
    ).catch(() => null);
    setRows((d?.data as Target[] | undefined) ?? []);
    if (!d) setMsg('Could not load targets.');
  }, [from, to, hq]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(overwrite: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await apiReady();
      const { data, error } = await api.PUT('/v1/sales/targets', {
        body: {
          territoryId: hq,
          kind,
          fromMonth: from,
          toMonth: to,
          value: Number(value),
          spread,
          quantity: null,
          brand: scope === 'brand' ? brand : null,
          overwrite,
        },
      });
      if (error || !data) {
        const e = toApiError(error);
        if (e.code === 'TARGETS_EXIST') {
          if (window.confirm('Some months already have a target. Replace them?')) return save(true);
          return;
        }
        throw new Error(e.message);
      }
      setMsg(`Saved ${data.months} month${data.months === 1 ? '' : 's'}.`);
      await load();
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Target) {
    const who = row.brand ?? row.territoryName;
    if (!window.confirm(`Delete the ${row.kind} target for ${who}, ${monthLabel(row.month)}?`))
      return;
    setMsg(null);
    try {
      await apiReady();
      const { error } = await api.DELETE('/v1/sales/targets/{id}', {
        params: { path: { id: row.id } },
      });
      if (error) throw new Error(toApiError(error).message);
      await load();
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not delete.');
    }
  }

  const shown = rows.filter((row) => (scope === 'brand' ? row.brand : !row.brand));
  const ready =
    !!hq && Number(value) >= 0 && value !== '' && from <= to && (scope === 'hq' || !!brand);
  return (
    <section className={box} data-testid={scope === 'brand' ? 'brand-targets' : 'targets-panel'}>
      <h2 className="text-sm font-semibold">
        {scope === 'brand' ? 'Brand target' : 'Headquarters target'}
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          HQ
          <select
            className={field}
            value={hq}
            onChange={(e) => setHq(e.target.value)}
            aria-label="HQ"
          >
            <option value="">Select HQ</option>
            {hqs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        {scope === 'brand' && (
          <label className="flex flex-col gap-1 text-xs">
            Brand
            <select
              className={field}
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              aria-label="Brand"
            >
              <option value="">Select brand</option>
              {brands.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs">
          Type
          <select className={field} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="primary">Primary</option>
            <option value="secondary">Secondary</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          From
          <input
            type="month"
            className={field}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          To
          <input
            type="month"
            className={field}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Amount (₹)
          <Input
            type="number"
            min={0}
            className="h-9 w-36"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Amount is
          <select
            className={field}
            value={spread}
            onChange={(e) => setSpread(e.target.value as 'each' | 'total')}
          >
            <option value="each">For each month</option>
            <option value="total">Total, split evenly</option>
          </select>
        </label>
        <Button disabled={!ready || busy} onClick={() => void save(false)}>
          Save target
        </Button>
      </div>
      {msg && (
        <p
          className={`text-sm ${msg.startsWith('Saved') ? 'text-muted-foreground' : 'text-destructive'}`}
          role={msg.startsWith('Saved') ? 'status' : 'alert'}
        >
          {msg}
        </p>
      )}
      {shown.length > 0 && (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">HQ</th>
                {scope === 'brand' && <th>Brand</th>}
                <th>Month</th>
                <th>Type</th>
                <th className="text-right">Target</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-1">{r.territoryName}</td>
                  {scope === 'brand' && <td>{r.brand}</td>}
                  <td>{monthLabel(r.month)}</td>
                  <td className="capitalize">{r.kind}</td>
                  <td className="text-right tabular-nums">{inr(r.value)}</td>
                  <td className="text-right">
                    <span className="inline-flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setHq(r.territoryId);
                          setBrand(r.brand ?? '');
                          setKind(r.kind);
                          setFrom(r.month);
                          setTo(r.month);
                          setValue(String(r.value));
                          setSpread('each');
                        }}
                      >
                        <Pencil /> Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void remove(r)}
                      >
                        <Trash2 /> Delete
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
