'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { Dcr } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import { api } from '@/lib/api';

type CallT = Dcr['calls'][number];
export type PobDraft = { productId: string; quantity: string; stockistId: string };
export type RcpaDraft = {
  productId: string;
  competitorBrand: string;
  competitorCompany: string;
  quantity: string;
  prescriptions: string;
};
export type Opt = { id: string; name: string; pts?: number | null };

const NONE = '__none';
const digits = (v: string, n = 6) => v.replace(/\D/g, '').slice(0, n);

/** POB lines as sent to PUT /v1/dcrs. `value` is server-computed (qty × PTR) and never sent. */
export function pobPayload(rows: PobDraft[]): CallT['pob'] {
  return rows
    .filter((r) => r.productId && Number(r.quantity) > 0)
    .map((r) => ({
      productId: r.productId,
      quantity: Number(r.quantity),
      stockistId: r.stockistId || null,
    }));
}
export function rcpaPayload(rows: RcpaDraft[]): CallT['rcpa'] {
  return rows
    .filter((r) => r.productId && Number(r.quantity) > 0)
    .map((r) => ({
      productId: r.productId,
      competitorBrand: r.competitorBrand.trim() || null,
      competitorCompany: r.competitorBrand.trim() ? r.competitorCompany.trim() || null : null,
      quantity: Number(r.quantity),
      prescriptions: r.prescriptions ? Number(r.prescriptions) : null,
    }));
}
/** Strip server-computed values before sending a saved call back. */
export const stripPobValue = (pob: CallT['pob']): CallT['pob'] =>
  pob.map(({ value: _v, ...l }) => l);

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});
/** Order value shown on a call: only server-computed values; lines not yet saved show "value after save". */
export function pobSummary(pob: CallT['pob']): string {
  if (!pob.length) return '';
  const known = pob.filter((l) => typeof l.value === 'number');
  const pending = pob.some((l) => l.value === undefined);
  const noPtr = pob.some((l) => l.value === null);
  const total = known.reduce((s, l) => s + (l.value ?? 0), 0);
  const parts = [`Order ${pob.length} line${pob.length > 1 ? 's' : ''}`];
  if (known.length) parts.push(inr.format(total));
  if (pending) parts.push('value after save');
  else if (noPtr) parts.push('some products have no price');
  return parts.join(', ');
}

/** Plain-words message for a DCR save 422 with POB/RCPA details. Returns null when none apply. */
export function pobRcpaMessage(
  details: unknown,
  productName: (id: string) => string,
): string | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  const has = (k: string) => Array.isArray(d[k]) && (d[k] as unknown[]).length > 0;
  const names = (k: string) => (d[k] as string[]).map(productName).join(', ');
  const out: string[] = [];
  if (has('inactiveProductIds'))
    out.push(`These products are no longer active: ${names('inactiveProductIds')}.`);
  if (has('productIds')) out.push(`These products are not recognised: ${names('productIds')}.`);
  if (has('duplicatePob'))
    out.push('A product appears twice in one order. Combine the quantities on one line.');
  if (has('duplicateRcpa'))
    out.push('The same product and competitor brand appear twice in one RCPA. Keep one line.');
  if (has('stockistIds')) out.push('A chosen stockist is not in your list. Pick another stockist.');
  if (has('rcpaDoctorIds')) out.push('A prescribing doctor in RCPA is not in your territory.');
  if (has('rcpaOutletCallIds')) out.push('RCPA can only be recorded on chemist calls.');
  if (has('pobOutletCallIds')) out.push('An order cannot be recorded on this call type.');
  return out.length ? out.join(' ') : null;
}

/** Live POB value at PTS (qty x pts), counting only lines with a product and quantity. */
export function pobDraftTotal(rows: PobDraft[], byId: Map<string, Opt>) {
  let value = 0;
  let unpriced = 0;
  let lines = 0;
  for (const r of rows) {
    const qty = Number(r.quantity);
    if (!r.productId || !(qty > 0)) continue;
    lines++;
    const pts = byId.get(r.productId)?.pts;
    if (typeof pts === 'number') value += Math.round(qty * pts * 100) / 100;
    else unpriced++;
  }
  return { value, unpriced, lines };
}

function PobLineValue({ row, product }: { row: PobDraft; product: Opt | undefined }) {
  if (!row.productId) return null;
  const qty = Number(row.quantity);
  const pts = product?.pts;
  if (typeof pts !== 'number')
    return <p className="text-xs text-warning-text">Price not set for this product</p>;
  return (
    <p className="text-xs text-muted-foreground tabular-nums" data-testid="pob-line-value">
      PTS {inr.format(pts)}
      {qty > 0 && <> · {inr.format(Math.round(qty * pts * 100) / 100)}</>}
    </p>
  );
}

export function PobEditor({
  rows,
  onChange,
  products,
  stockists,
  showStockist,
}: {
  rows: PobDraft[];
  onChange: (r: PobDraft[]) => void;
  products: Opt[];
  stockists: Opt[];
  showStockist: boolean;
}) {
  const set = (i: number, p: Partial<PobDraft>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const byId = new Map(products.map((o) => [o.id, o]));
  const total = pobDraftTotal(rows, byId);
  return (
    <fieldset className="flex flex-col gap-2" data-testid="pob">
      <legend className="mb-1.5 text-sm font-medium">Order booked (POB)</legend>
      <p className="text-xs text-muted-foreground">
        Valued at the product's price to stockist (PTS); the server confirms it when you save.
      </p>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div
            className="grid grid-cols-[1fr_5rem_auto] gap-2 sm:grid-cols-[1fr_5rem_10rem_auto]"
            data-testid="pob-row"
          >
            <Select value={r.productId} onValueChange={(v) => set(i, { productId: v })}>
              <SelectTrigger
                className="w-full"
                aria-label="Order product"
                data-testid="pob-product"
              >
                <SelectValue placeholder="Product" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label="Order quantity"
              inputMode="numeric"
              placeholder="Qty"
              className="text-right md:text-base"
              value={r.quantity}
              onChange={(e) => set(i, { quantity: digits(e.target.value) })}
              data-testid="pob-qty"
            />
            {showStockist && (
              <Select
                value={r.stockistId || NONE}
                onValueChange={(v) => set(i, { stockistId: v === NONE ? '' : v })}
              >
                <SelectTrigger
                  className="col-span-2 w-full sm:col-span-1"
                  aria-label="Supplying stockist"
                  data-testid="pob-stockist"
                >
                  <SelectValue placeholder="Stockist" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No stockist</SelectItem>
                  {stockists.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove order line"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
          <PobLineValue row={r} product={byId.get(r.productId)} />
        </div>
      ))}
      {total.lines > 0 && (
        <div
          className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm"
          data-testid="pob-total"
        >
          <span className="font-medium">Call total</span>
          <span className="font-semibold tabular-nums">
            {inr.format(total.value)}
            {total.unpriced > 0 && (
              <span className="ml-2 text-xs font-normal text-warning-text">
                {total.unpriced} without price
              </span>
            )}
          </span>
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={products.length === 0}
        onClick={() => onChange([...rows, { productId: '', quantity: '', stockistId: '' }])}
        data-testid="pob-add"
      >
        <Plus /> Add order line
      </Button>
      {products.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No products are set up yet. Ask your administrator.
        </p>
      )}
    </fieldset>
  );
}

export function RcpaEditor({
  rows,
  onChange,
  products,
}: {
  rows: RcpaDraft[];
  onChange: (r: RcpaDraft[]) => void;
  products: Opt[];
}) {
  const set = (i: number, p: Partial<RcpaDraft>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const listId = useId();
  const [brands, setBrands] = useState<{ brand: string; company: string | null }[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      void api
        .GET('/v1/rcpa/competitor-brands', { params: { query: { q: q || undefined, limit: 20 } } })
        .then((r) => r.data && setBrands(r.data.items));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <fieldset className="flex flex-col gap-2" data-testid="rcpa">
      <legend className="mb-1.5 text-sm font-medium">Prescription audit (RCPA)</legend>
      <p className="text-xs text-muted-foreground">
        Leave the competitor brand empty to count our own brand.
      </p>
      <datalist id={listId}>
        {brands.map((b) => (
          <option key={b.brand} value={b.brand}>
            {b.company ?? ''}
          </option>
        ))}
      </datalist>
      {rows.map((r, i) => (
        <div
          key={i}
          className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1fr_1fr_4.5rem_4.5rem_auto]"
          data-testid="rcpa-row"
        >
          <Select value={r.productId} onValueChange={(v) => set(i, { productId: v })}>
            <SelectTrigger
              className="col-span-2 w-full sm:col-span-1"
              aria-label="Our product"
              data-testid="rcpa-product"
            >
              <SelectValue placeholder="Our product" />
            </SelectTrigger>
            <SelectContent>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label="Competitor brand"
            placeholder="Competitor brand"
            list={listId}
            maxLength={100}
            className="md:text-base"
            value={r.competitorBrand}
            onChange={(e) => {
              const v = e.target.value;
              const hit = brands.find((b) => b.brand.toLowerCase() === v.trim().toLowerCase());
              set(i, {
                competitorBrand: v,
                ...(hit?.company && !r.competitorCompany ? { competitorCompany: hit.company } : {}),
              });
              setQ(v.trim());
            }}
            data-testid="rcpa-brand"
          />
          <Input
            aria-label="Competitor company"
            placeholder="Company"
            maxLength={100}
            disabled={!r.competitorBrand.trim()}
            className="md:text-base"
            value={r.competitorCompany}
            onChange={(e) => set(i, { competitorCompany: e.target.value })}
            data-testid="rcpa-company"
          />
          <Input
            aria-label="Units"
            placeholder="Units"
            inputMode="numeric"
            className="text-right md:text-base"
            value={r.quantity}
            onChange={(e) => set(i, { quantity: digits(e.target.value) })}
            data-testid="rcpa-qty"
          />
          <Input
            aria-label="Prescriptions"
            placeholder="Rx"
            inputMode="numeric"
            className="text-right md:text-base"
            value={r.prescriptions}
            onChange={(e) => set(i, { prescriptions: digits(e.target.value) })}
            data-testid="rcpa-rx"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove RCPA line"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={products.length === 0}
        onClick={() =>
          onChange([
            ...rows,
            {
              productId: '',
              competitorBrand: '',
              competitorCompany: '',
              quantity: '',
              prescriptions: '',
            },
          ])
        }
        data-testid="rcpa-add"
      >
        <Plus /> Add RCPA line
      </Button>
    </fieldset>
  );
}
