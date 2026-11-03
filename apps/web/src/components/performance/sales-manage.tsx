'use client';

import { Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { api, apiReady, toApiError } from '@/lib/api';
import { allPages } from '@/lib/paging';
import { monthLabel } from '@/lib/period';
import { readFile } from '@/components/masters/import-wizard';
import { inr } from './perf-ui';

type Kind = 'primary' | 'secondary';
type Hq = { id: string; name: string; code: string | null };
type Product = { id: string; name: string; code: string };
type Target = {
  id: string;
  territoryId: string;
  territoryName: string;
  territoryCode: string;
  month: string;
  kind: Kind;
  value: number;
};
type Actual = {
  id: string;
  territoryName: string;
  productName: string;
  kind: Kind;
  quantity: number;
  value: number;
  isReturn: boolean;
};
type ImportRow = {
  territoryCode: string;
  productCode: string | null;
  month: string;
  kind: Kind;
  value: number;
  quantity: number | null;
  freeQuantity: number;
  isReturn: boolean;
};
type ImportResult = {
  dryRun: boolean;
  totals: { rows: number; valid: number; created: number; updated: number; errors: number };
  results: { row: number; status: string; error: string | null }[];
};

const field = 'h-9 rounded-md border bg-background px-2 text-sm';
const box = 'flex flex-col gap-3 rounded-lg border p-4';
const ERRORS: Record<string, string> = {
  unknown_territory: 'Unknown territory code',
  not_headquarter: 'Not an HQ',
  unknown_product: 'Unknown product code',
  product_required: 'Product code needed',
};
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
          .map((x) => ({ id: x.id, name: x.name, code: x.code })),
      );
    })();
  }, []);
  return { hqs, products };
}

export function SalesManage({ onChanged }: { onChanged: () => void }) {
  const { hqs, products } = useHqs();
  return (
    <div className="flex flex-col gap-5" data-testid="sales-manage">
      <TargetsPanel hqs={hqs} onChanged={onChanged} />
      <ActualsPanel hqs={hqs} products={products} onChanged={onChanged} />
      <UploadPanel onChanged={onChanged} />
    </div>
  );
}

function TargetsPanel({ hqs, onChanged }: { hqs: Hq[]; onChanged: () => void }) {
  const [hq, setHq] = useState('');
  const [kind, setKind] = useState<Kind>('primary');
  const [from, setFrom] = useState(thisMonth());
  const [to, setTo] = useState(thisMonth());
  const [value, setValue] = useState('');
  const [spread, setSpread] = useState<'each' | 'total'>('each');
  const [rows, setRows] = useState<Target[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    await apiReady();
    const d = await call(
      api.GET('/v1/sales/targets', {
        params: { query: { from, to, ...(hq ? { territoryId: hq } : {}) } },
      }),
    ).catch(() => null);
    setRows((d?.data as Target[] | undefined) ?? []);
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

  const ready = !!hq && Number(value) >= 0 && value !== '' && from <= to;
  return (
    <section className={box} data-testid="targets-panel">
      <h2 className="text-sm font-semibold">Set a target</h2>
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
        <p className="text-sm text-muted-foreground" role="status">
          {msg}
        </p>
      )}
      {rows.length > 0 && (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">HQ</th>
                <th>Month</th>
                <th>Type</th>
                <th className="text-right">Target</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-1">{r.territoryName}</td>
                  <td>{monthLabel(r.month)}</td>
                  <td className="capitalize">{r.kind}</td>
                  <td className="text-right tabular-nums">{inr(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ActualsPanel({
  hqs,
  products,
  onChanged,
}: {
  hqs: Hq[];
  products: Product[];
  onChanged: () => void;
}) {
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState<Actual[]>([]);
  const [hq, setHq] = useState('');
  const [product, setProduct] = useState('');
  const [kind, setKind] = useState<Kind>('primary');
  const [value, setValue] = useState('');
  const [qty, setQty] = useState('');
  const [isReturn, setIsReturn] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    await apiReady();
    const d = await call(api.GET('/v1/sales/actuals', { params: { query: { month } } })).catch(
      () => null,
    );
    setRows((d?.data as Actual[] | undefined) ?? []);
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setMsg(null);
    try {
      await apiReady();
      await call(
        api.POST('/v1/sales/actuals', {
          body: {
            territoryId: hq,
            productId: product,
            stockistId: null,
            month,
            kind,
            quantity: qty === '' ? 0 : Number(qty),
            freeQuantity: 0,
            value: Number(value),
            isReturn,
          },
        }),
      );
      setValue('');
      setQty('');
      await load();
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not add.');
    }
  }

  async function remove(id: string) {
    await apiReady();
    await api.DELETE('/v1/sales/actuals/{id}', { params: { path: { id } } });
    await load();
    onChanged();
  }

  return (
    <section className={box} data-testid="actuals-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Actual sales</h2>
        <input
          type="month"
          className={field}
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <select
          className={field}
          value={hq}
          onChange={(e) => setHq(e.target.value)}
          aria-label="HQ"
        >
          <option value="">HQ</option>
          {hqs.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <select
          className={field}
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          aria-label="Product"
        >
          <option value="">Product</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className={field} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="primary">Primary</option>
          <option value="secondary">Secondary</option>
        </select>
        <Input
          type="number"
          min={0}
          placeholder="Qty"
          className="h-9 w-24"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <Input
          type="number"
          min={0}
          placeholder="Value ₹"
          className="h-9 w-32"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={isReturn}
            onChange={(e) => setIsReturn(e.target.checked)}
          />
          Return
        </label>
        <Button disabled={!hq || !product || value === ''} onClick={() => void add()}>
          Add
        </Button>
      </div>
      {msg && <p className="text-sm text-destructive">{msg}</p>}
      <div className="max-h-64 overflow-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sales entered for {monthLabel(month)}.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-1">{r.territoryName}</td>
                  <td>{r.productName}</td>
                  <td className="capitalize">
                    {r.kind}
                    {r.isReturn ? ' (return)' : ''}
                  </td>
                  <td className="text-right tabular-nums">{r.quantity}</td>
                  <td className="text-right tabular-nums">{inr(r.value)}</td>
                  <td className="w-8 text-right">
                    <button
                      type="button"
                      aria-label="Delete row"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => void remove(r.id)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const num = (s: string | undefined) => {
  const n = Number((s ?? '').replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/** Accepts yyyy-mm, yyyy-mm-dd, or dd/mm/yyyy; returns yyyy-mm or null. */
function toMonth(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}` : null;
}

function UploadPanel({ onChanged }: { onChanged: () => void }) {
  const [entity, setEntity] = useState<'targets' | 'actuals'>('actuals');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [saved, setSaved] = useState<ImportResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const run = useCallback(
    async (dryRun: boolean, data: ImportRow[]) => {
      setBusy(true);
      setMsg(null);
      try {
        await apiReady();
        const r = (await call(
          api.POST('/v1/sales/import', { body: { entity, dryRun, rows: data } }),
        )) as ImportResult;
        if (dryRun) setPreview(r);
        else {
          setSaved(r);
          onChanged();
        }
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'Import failed.');
      } finally {
        setBusy(false);
      }
    },
    [entity, onChanged],
  );

  async function pick(file: File) {
    setSaved(null);
    setPreview(null);
    setMsg(null);
    const sheet = await readFile(file);
    const idx = (...names: string[]) => sheet.headers.findIndex((h) => names.includes(norm(h)));
    const c = {
      terr: idx('territorycode', 'hqcode', 'hq', 'territory'),
      prod: idx('productcode', 'product', 'sku'),
      month: idx('month', 'period'),
      kind: idx('kind', 'type'),
      value: idx('value', 'amount', 'target'),
      qty: idx('quantity', 'qty'),
      free: idx('freequantity', 'freeqty', 'free'),
      ret: idx('return', 'isreturn'),
    };
    if (c.terr < 0 || c.month < 0 || c.value < 0) {
      setMsg('Columns needed: territory_code, month, value (and kind, product_code for actuals).');
      return;
    }
    const out: ImportRow[] = [];
    const bad: string[] = [];
    sheet.rows.slice(0, 2000).forEach((r, i) => {
      const month = toMonth(r[c.month] ?? '');
      const value = num(r[c.value]);
      const kindRaw = c.kind >= 0 ? norm(r[c.kind] ?? '') : 'primary';
      const kind: Kind | null = kindRaw.startsWith('sec')
        ? 'secondary'
        : kindRaw.startsWith('pri') || !kindRaw
          ? 'primary'
          : null;
      if (!month || Number.isNaN(value) || value < 0 || !kind) {
        bad.push(`Row ${i + 2}: check month, value and type`);
        return;
      }
      const q = c.qty >= 0 && r[c.qty] ? num(r[c.qty]) : NaN;
      out.push({
        territoryCode: (r[c.terr] ?? '').trim(),
        productCode: c.prod >= 0 && r[c.prod]?.trim() ? r[c.prod]!.trim() : null,
        month,
        kind,
        value,
        quantity: Number.isNaN(q) ? null : Math.round(q),
        freeQuantity: c.free >= 0 && r[c.free] ? Math.max(0, Math.round(num(r[c.free]))) || 0 : 0,
        isReturn: c.ret >= 0 && /^(1|y|yes|true)$/i.test((r[c.ret] ?? '').trim()),
      });
    });
    setSkipped(bad);
    setRows(out);
    if (out.length) await run(true, out);
  }

  const errors = useMemo(
    () => preview?.results.filter((r) => r.status === 'error') ?? [],
    [preview],
  );
  return (
    <section className={box} data-testid="sales-upload">
      <h2 className="text-sm font-semibold">Upload from Excel or CSV</h2>
      <p className="text-xs text-muted-foreground">
        Columns: territory_code (the HQ), month (YYYY-MM), value, type (primary or secondary),
        product_code, quantity. Product code is required for actual sales and ignored for targets.
        Re-uploading targets replaces the month.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <select
          className={field}
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value as 'targets' | 'actuals');
            setRows([]);
            setPreview(null);
            setSaved(null);
          }}
          aria-label="What are you uploading"
        >
          <option value="actuals">Actual sales</option>
          <option value="targets">Targets</option>
        </select>
        <input
          ref={input}
          type="file"
          accept=".csv,.xlsx"
          data-testid="sales-file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pick(f);
            e.target.value = '';
          }}
        />
        <Button variant="outline" onClick={() => input.current?.click()}>
          <Upload className="size-4" /> Choose file
        </Button>
      </div>
      {msg && <p className="text-sm text-destructive">{msg}</p>}
      {skipped.length > 0 && (
        <p className="text-sm text-amber-700">
          {skipped.length} row{skipped.length === 1 ? '' : 's'} skipped:{' '}
          {skipped.slice(0, 3).join('; ')}
        </p>
      )}
      {preview && !saved && (
        <div className="flex flex-col gap-2" data-testid="sales-preview">
          <p className="text-sm">
            {preview.totals.valid} of {preview.totals.rows} rows are ready
            {errors.length ? `, ${errors.length} have problems` : ''}.
          </p>
          {errors.slice(0, 8).map((r) => (
            <p key={r.row} className="text-xs text-destructive">
              Row {r.row + 1}: {ERRORS[r.error ?? ''] ?? r.error}
            </p>
          ))}
          <div>
            <Button
              disabled={busy || preview.totals.valid === 0}
              onClick={() => void run(false, rows)}
            >
              Import {preview.totals.valid} rows
            </Button>
          </div>
        </div>
      )}
      {saved && (
        <p className="text-sm" role="status" data-testid="sales-saved">
          Imported: {saved.totals.created} added, {saved.totals.updated} updated,{' '}
          {saved.totals.errors} skipped.
        </p>
      )}
    </section>
  );
}
