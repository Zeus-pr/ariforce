'use client';

import { History, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@ariforce/ui/components/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ariforce/ui/components/table';
import { toast } from '@ariforce/ui/components/sonner';
import { useRole } from '@/components/shell/role-context';
import { api, apiReady, toApiError } from '@/lib/api';
import { canEditProductPrices } from '@/lib/permissions';
import type { ProductImageResult } from '@/lib/products/product-image';
import { ProductImageCell, ProductImageDialog } from './product-image';
import {
  PRICE_KEYS,
  chunks,
  diff,
  fmt,
  priceError,
  type AdminProduct,
  type BulkResult,
  type PriceEdit,
  type PriceKey,
} from './prices';

const PAGE = 50;
type HistoryEntry = { id: string; old: Record<PriceKey, number | null>; new: Record<PriceKey, number | null>; source: string; changedBy: { name: string }; changedAt: string };
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ProductPricesView() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [missing, setMissing] = useState(false);
  const [rows, setRows] = useState<AdminProduct[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, PriceEdit>>({});
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<{ total: number; updated: number; unchanged: number; failed: number; failures: BulkResult[] } | null>(null);
  const [historyFor, setHistoryFor] = useState<AdminProduct | null>(null);
  const [imageFor, setImageFor] = useState<AdminProduct | null>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const { role } = useRole();
  // Same permission as price edits (`products:prices`); the API enforces it too.
  const canEdit = canEditProductPrices(role);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(
    async (after: string | null) => {
      setLoading(true);
      setError(null);
      await apiReady();
      const r = await api.GET('/v1/admin/products', {
        params: { query: { limit: PAGE, ...(debounced ? { q: debounced } : {}), ...(missing ? { missingPtr: 'true' as const } : {}), ...(after ? { cursor: after } : {}) } },
      });
      setLoading(false);
      if (!r.data) {
        const e = toApiError(r);
        setError(e.code === 'FORBIDDEN' ? 'Only the System Admin can see product prices.' : e.message || 'Could not load products.');
        if (!after) setRows([]);
        return;
      }
      setRows((prev) => (after && prev ? [...prev, ...r.data.items] : r.data.items));
      setCursor(r.data.nextCursor);
    },
    [debounced, missing],
  );
  useEffect(() => {
    void load(null);
  }, [load]);

  const dirtyIds = useMemo(
    () => (rows ?? []).filter((p) => { const d = diff(p, edits[p.id]); return !d.ok || Object.keys(d.patch).length > 0; }).map((p) => p.id),
    [rows, edits],
  );

  const setEdit = (id: string, k: PriceKey, v: string) => {
    setEdits((e) => ({ ...e, [id]: { ...e[id], [k]: v.replace(/[^\d.,]/g, '').slice(0, 12) } }));
    setRowErr(({ [id]: _drop, ...rest }) => rest);
  };
  const clearEdit = (id: string) => setEdits(({ [id]: _drop, ...rest }) => rest);

  async function saveRow(p: AdminProduct) {
    const d = diff(p, edits[p.id]);
    if (!d.ok) return setRowErr((e) => ({ ...e, [p.id]: d.message }));
    if (!Object.keys(d.patch).length) return clearEdit(p.id);
    setSaving((s) => ({ ...s, [p.id]: true }));
    const r = await api.PATCH('/v1/admin/products/{id}/prices', {
      params: { path: { id: p.id } },
      body: { ...d.patch, version: p.version },
    });
    setSaving((s) => ({ ...s, [p.id]: false }));
    if (!r.data) {
      const e = toApiError(r);
      return setRowErr((x) => ({ ...x, [p.id]: priceError(e.code, e.message) }));
    }
    setRows((rs) => rs?.map((x) => (x.id === p.id ? r.data : x)) ?? rs);
    clearEdit(p.id);
    toast.success(`Saved prices for ${p.name}`);
  }

  async function saveAll() {
    const list = (rows ?? []).filter((p) => dirtyIds.includes(p.id));
    const bad: Record<string, string> = {};
    const payload: { productId: string; mrp?: number | null; ptr?: number | null; pts?: number | null }[] = [];
    for (const p of list) {
      const d = diff(p, edits[p.id]);
      if (!d.ok) bad[p.id] = d.message;
      else payload.push({ productId: p.id, ...d.patch });
    }
    setRowErr((e) => ({ ...e, ...bad }));
    if (!payload.length) return;
    setBulkBusy(true);
    const sum = { total: 0, updated: 0, unchanged: 0, failed: 0, failures: [] as BulkResult[] };
    const failedMsg: Record<string, string> = {};
    for (const [ci, part] of chunks(payload).entries()) {
      const r = await api.POST('/v1/admin/products/prices/bulk', { body: { rows: part } });
      if (!r.data) {
        const e = toApiError(r);
        for (const row of part) failedMsg[row.productId] = priceError(e.code, e.message);
        sum.total += part.length;
        sum.failed += part.length;
        continue;
      }
      sum.total += r.data.summary.total;
      sum.updated += r.data.summary.updated;
      sum.unchanged += r.data.summary.unchanged;
      sum.failed += r.data.summary.failed;
      for (const res of r.data.results) {
        if (res.status !== 'failed') continue;
        const id = res.productId ?? part[res.index]?.productId;
        sum.failures.push({ ...res, index: res.index + ci * 300 });
        if (id) failedMsg[id] = priceError(res.code ?? undefined, res.message ?? undefined);
      }
    }
    setBulkBusy(false);
    setBulkSummary(sum);
    // Keep only failed edits, then reload to get the new prices and versions.
    setEdits((e) => Object.fromEntries(Object.entries(e).filter(([id]) => failedMsg[id] || bad[id])));
    setRowErr({ ...bad, ...failedMsg });
    void load(null);
  }

  // Keep the row's image (and version, if the API bumped it) in step without a reload.
  const imageSaved = (id: string, r: ProductImageResult) => {
    const merge = (x: AdminProduct) => (x.id === id ? { ...x, imageUrl: r.imageUrl, ...(r.version ? { version: r.version } : {}) } : x);
    setRows((rs) => rs?.map(merge) ?? rs);
    setImageFor((x) => (x ? merge(x) : x));
  };

  const nameOf = (id: string | null | undefined) => rows?.find((p) => p.id === id)?.name ?? id ?? '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <Label htmlFor="pp-search">Search</Label>
          <Input id="pp-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Code or name" className="md:text-base" data-testid="pp-search" />
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} data-testid="pp-missing" className="size-4 accent-primary" />
          Only products with no PTR
        </label>
        <Button className="ml-auto" disabled={bulkBusy || dirtyIds.length === 0} onClick={() => void saveAll()} data-testid="pp-save-all">
          <Save /> {bulkBusy ? 'Saving…' : `Save all changes${dirtyIds.length ? ` (${dirtyIds.length})` : ''}`}
        </Button>
      </div>

      {bulkSummary && (
        <div className="rounded-lg border p-3 text-sm" data-testid="pp-bulk-summary" role="status">
          <p>
            Saved {bulkSummary.total} row{bulkSummary.total === 1 ? '' : 's'}: {bulkSummary.updated} updated, {bulkSummary.unchanged} unchanged, {bulkSummary.failed} failed.
          </p>
          {bulkSummary.failures.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-destructive" data-testid="pp-bulk-failures">
              {bulkSummary.failures.map((f) => (
                <li key={f.index}>{f.productCode ?? nameOf(f.productId)}: {priceError(f.code ?? undefined, f.message ?? undefined)}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-sm text-destructive" data-testid="pp-error">{error}</p>}

      {rows && rows.length === 0 && !loading && !error ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground" data-testid="pp-empty">
          {debounced || missing ? 'No products match these filters.' : 'No products yet. Add products in Masters first.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="pp-table">
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="w-28 text-right">MRP</TableHead>
                <TableHead className="w-28 text-right">PTR</TableHead>
                <TableHead className="w-28 text-right">PTS</TableHead>
                <TableHead className="hidden lg:table-cell">Last price change</TableHead>
                <TableHead className="w-32"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((p) => {
                const e = edits[p.id];
                const dirty = dirtyIds.includes(p.id);
                return (
                  <TableRow key={p.id} data-testid="pp-row" data-code={p.code} data-dirty={dirty ? '' : undefined}>
                    <TableCell className="align-top">
                      <div className="flex items-start gap-3">
                        <ProductImageCell
                          product={p}
                          canEdit={canEdit}
                          onOpen={() => {
                            setImageFor(p);
                            setImageOpen(true);
                          }}
                        />
                        <div className="min-w-0">
                          <div className="font-medium">{p.name}</div>
                          <ProductSubline product={p} />
                          {p.ptr == null && <Badge variant="outline" className="mt-1 border-amber-500 text-amber-700" data-testid="pp-no-ptr">No PTR</Badge>}
                          {rowErr[p.id] && <p className="mt-1 text-xs text-destructive" role="alert" data-testid="pp-row-error">{rowErr[p.id]}</p>}
                        </div>
                      </div>
                    </TableCell>
                    {PRICE_KEYS.map((k) => (
                      <TableCell key={k} className="align-top">
                        <Input
                          aria-label={`${k.toUpperCase()} for ${p.name}`}
                          inputMode="decimal"
                          className="text-right tabular-nums md:text-base"
                          value={e?.[k] ?? fmt(p[k])}
                          onChange={(ev) => setEdit(p.id, k, ev.target.value)}
                          onKeyDown={(ev) => ev.key === 'Enter' && void saveRow(p)}
                          data-testid={`pp-${k}`}
                        />
                      </TableCell>
                    ))}
                    <TableCell className="hidden align-top text-xs text-muted-foreground lg:table-cell">
                      {p.pricesUpdatedAt ? <>{when(p.pricesUpdatedAt)}{p.updatedBy && <><br />{p.updatedBy.name}</>}</> : 'Never'}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex gap-1">
                        <Button size="sm" variant={dirty ? 'default' : 'outline'} disabled={!dirty || saving[p.id]} onClick={() => void saveRow(p)} data-testid="pp-save">
                          {saving[p.id] ? 'Saving…' : 'Save'}
                        </Button>
                        <Button size="icon" variant="ghost" aria-label={`Price history for ${p.name}`} onClick={() => setHistoryFor(p)} data-testid="pp-history">
                          <History />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {(loading || cursor) && (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loading} onClick={() => void load(cursor)} data-testid="pp-more">
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
      <HistorySheet product={historyFor} onClose={() => setHistoryFor(null)} />
      {canEdit && <ProductImageDialog product={imageFor} open={imageOpen} onOpenChange={setImageOpen} onSaved={imageSaved} />}
    </div>
  );
}

function HistorySheet({ product, onClose }: { product: AdminProduct | null; onClose: () => void }) {
  const [items, setItems] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!product) return;
    setItems(null);
    setError(null);
    void api.GET('/v1/admin/products/{id}/price-history', { params: { path: { id: product.id } } }).then((r) => {
      if (r.data) setItems(r.data.items);
      else setError(priceError(toApiError(r).code, toApiError(r).message));
    });
  }, [product]);
  const show = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-IN', { minimumFractionDigits: 2 }));
  return (
    <Sheet open={!!product} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md" data-testid="pp-history-sheet">
        <SheetHeader>
          <SheetTitle>Price history</SheetTitle>
          <SheetDescription>{product?.name} ({product?.code})</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {items === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
          {items?.length === 0 && <p className="text-sm text-muted-foreground" data-testid="pp-history-empty">No price changes yet.</p>}
          {items?.map((h) => (
            <div key={h.id} className="rounded-md border p-2 text-sm" data-testid="pp-history-item">
              <p className="text-xs text-muted-foreground">
                {when(h.changedAt)} · {h.changedBy.name} · {h.source === 'bulk' ? 'bulk save' : h.source === 'masters' ? 'product edit' : 'single save'}
              </p>
              {PRICE_KEYS.filter((k) => h.old[k] !== h.new[k]).map((k) => (
                <p key={k} className="tabular-nums">
                  {k.toUpperCase()}: {show(h.old[k])} → {show(h.new[k])}
                </p>
              ))}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Composition and strip size under the name (brand usually repeats the name, so it is not shown). */
function ProductSubline({ product: p }: { product: AdminProduct & { composition?: string | null; packSize?: string | null } }) {
  const comp = p.composition?.trim();
  const pack = p.packSize?.trim();
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span className="min-w-0 truncate" title={comp ?? p.code}>{comp || p.code}</span>
      {pack && (
        <span className="shrink-0 rounded-md border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-foreground/80">
          Strip · {pack}
        </span>
      )}
      {!p.active && <span className="shrink-0">· inactive</span>}
    </div>
  );
}
