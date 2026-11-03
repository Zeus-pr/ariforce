'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Dcr, Doctor, TourPlan, WorkType } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { EmptyOptions } from '@/components/forms/empty-options';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import { toast } from '@ariforce/ui/components/sonner';
import { cn } from '@ariforce/ui/lib/utils';
import { dateLabel, timeIST, todayIST } from '@/components/attendance/format';
import { LookupsProvider, useLookups } from '@/components/masters/lookups';
import { api, apiReady, toApiError } from '@/lib/api';
import { saveMessage } from '@/lib/leave/model';
import { dcrDateClosedText, dcrDateNotTodayMessage, dcrDateOpen } from '@/lib/dcr/date-rule';
import { productImageUrl } from '@/lib/products/product-image';
import { OutletPicker, TerritoryFilter } from '@/components/pickers/pickers';
import { territoryLabel, workTerritories } from '@/lib/territories';
import {
  PobEditor,
  RcpaEditor,
  pobPayload,
  pobRcpaMessage,
  pobSummary,
  rcpaPayload,
  stripPobValue,
  type Opt,
  type PobDraft,
  type RcpaDraft,
} from './pob-rcpa';
import { ProductImg } from '@/components/media/product-img';
import { cachedGet } from '@/lib/query';
import { getProducts } from '@/lib/query';

/** What the call form needs from a product. */
type PickProduct = {
  id: string;
  name: string;
  detail: string | null;
  isSample: boolean;
  imageUrl: string | null;
};

type Call = Omit<Dcr['calls'][number], 'id'> & { clientId: string };
type Kind = Call['outletKind'];
const KIND_LABEL: Record<Kind, string> = {
  doctor: 'Doctor',
  chemist: 'Chemist',
  stockist: 'Stockist',
};
type Planned = TourPlan['days'][number]['entries'][number];
const noop = () => () => {};

export function DcrView() {
  const today = useSyncExternalStore(noop, todayIST, () => null);
  if (!today) return <div className="h-[560px]" aria-busy="true" />;
  return (
    <LookupsProvider>
      <DcrDay today={today} />
    </LookupsProvider>
  );
}

function DcrDay({ today }: { today: string }) {
  const { territories, byId } = useLookups();
  const [date, setDate] = useState(today);
  const [dcr, setDcr] = useState<Dcr | null | undefined>(undefined);
  const [planned, setPlanned] = useState<Planned | null>(null);
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [products, setProducts] = useState<PickProduct[]>([]);
  const [orderProducts, setOrderProducts] = useState<Opt[]>([]);
  const [chemists, setChemists] = useState<Opt[]>([]);
  const [stockists, setStockists] = useState<Opt[]>([]);
  const [wt, setWt] = useState('');
  const [terr, setTerr] = useState('');
  const [reason, setReason] = useState('');
  const [calls, setCalls] = useState<Call[]>([]);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      await apiReady();
      const [w, d, p, ch, st] = await Promise.all([
        api.GET('/v1/work-types', { params: { query: { limit: 100 } } }),
        cachedGet(['doctors', 'first-page'], () =>
          api.GET('/v1/doctors', { params: { query: { limit: 100, sort: 'name' } } }),
        ),
        getProducts().then((r) => ({ data: r.data && { items: r.data }, error: r.error })),
        api.GET('/v1/chemists', { params: { query: { limit: 100 } } }),
        api.GET('/v1/stockists', { params: { query: { limit: 100 } } }),
      ]);
      // POB/RCPA lines must reference contract products (the server prices them from PTR).
      if (p.data)
        setOrderProducts(
          p.data.items.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name })),
        );
      if (ch.data) setChemists(ch.data.items.map((x) => ({ id: x.id, name: x.name })));
      if (st.data) setStockists(st.data.items.map((x) => ({ id: x.id, name: x.name })));
      if (w.data) setWorkTypes(w.data.items.filter((x) => x.active));
      if (d.data) setDoctors(d.data.items);
      if (p.data)
        setProducts(
          p.data.items
            .filter((x) => x.active)
            .map((x) => ({
              id: x.id,
              name: x.name,
              detail: x.composition,
              isSample: x.isSample,
              imageUrl: productImageUrl(x),
            })),
        );
    })().catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setDcr(undefined);
    setError(null);
    await apiReady();
    const [d, tp] = await Promise.all([
      api.GET('/v1/dcrs', { params: { query: { from: date, to: date, limit: 5 } } }),
      api.GET('/v1/tour-plans/{month}', { params: { path: { month: date.slice(0, 7) } } }),
    ]);
    if (d.error) return setError(toApiError(d).message);
    const found = d.data.items.find((x) => x.date === date) ?? null;
    const plan =
      tp.data?.status === 'approved'
        ? (tp.data.days.find((x) => x.date === date)?.entries[0] ?? null)
        : null;
    setPlanned(plan);
    setDcr(found);
    setWt(found?.workTypeId ?? plan?.workTypeId ?? '');
    setTerr(found?.territoryIds[0] ?? plan?.territoryIds[0] ?? '');
    setReason(found?.deviationReason ?? '');
    setCalls((found?.calls ?? []).map(({ id, ...c }) => ({ ...c, clientId: id })));
  }, [date]);
  useEffect(() => {
    void load();
  }, [load]);

  const workType = workTypes.find((w) => w.id === wt);
  const field = workType?.kind === 'field';
  const deviates =
    !!planned && (planned.workTypeId !== wt || (field && (planned.territoryIds[0] ?? '') !== terr));
  // Today only (IST); a past day only while unlocked. Other days are view-only (history).
  const dateClosed = !!today && !dcrDateOpen(date, today, dcr?.unlockedUntil ?? null);
  const locked = dcr?.status === 'submitted' || dcr?.status === 'locked' || dateClosed;
  const productName = useMemo(
    () => new Map([...orderProducts, ...products].map((p) => [p.id, p.name])),
    [products, orderProducts],
  );
  const [pickedNames, setPickedNames] = useState<Map<string, string>>(new Map());
  const outletName = useMemo(
    () =>
      new Map([
        ...[...doctors, ...chemists, ...stockists].map((o) => [o.id, o.name] as [string, string]),
        ...pickedNames,
      ]),
    [doctors, chemists, stockists, pickedNames],
  );
  const leaves = workTerritories(territories);

  const problems = [
    !wt && 'Choose what you worked on.',
    field && !terr && 'Choose the territory you worked.',
    workType?.requiresCalls && calls.length === 0 && 'Field work needs at least one call.',
    deviates && !reason.trim() && 'Say why the day differs from your approved tour plan.',
  ].filter(Boolean) as string[];

  async function save(submit: boolean) {
    setSaving(true);
    const r = await api.PUT('/v1/dcrs', {
      body: {
        date,
        workTypeId: wt,
        territoryIds: field && terr ? [terr] : [],
        deviationReason: deviates ? reason.trim() : null,
        // PobLine.value is computed by the server from PTR; never send it.
        calls: calls.map((c) => ({ ...c, pob: stripPobValue(c.pob) })),
        submit,
        ...(dcr ? { version: dcr.version } : {}),
      },
    });
    setSaving(false);
    if (r.error) {
      const e = toApiError(r);
      const pr =
        [
          rejectedDoctorsMessage(e.details, (id) => outletName.get(id) ?? 'a doctor'),
          pobRcpaMessage(e.details, (id) => productName.get(id) ?? 'a product'),
        ]
          .filter(Boolean)
          .join(' ') || null;
      if (e.code === 'DCR_DATE_NOT_TODAY')
        return toast.error(dcrDateNotTodayMessage(e.details, today ?? undefined), {
          duration: 10000,
        });
      return toast.error(pr ?? saveMessage(e), { duration: 10000 });
    }
    setDcr(r.data);
    setCalls(r.data.calls.map(({ id, ...c }) => ({ ...c, clientId: id })));
    toast.success(submit ? `DCR for ${dateLabel(date)} submitted` : 'Draft saved');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold" data-testid="dcr-date-label">
            {dateLabel(date)}
          </h2>
          <p className="text-sm text-muted-foreground" data-testid="dcr-status">
            {dcr === undefined
              ? 'Loading…'
              : !dcr
                ? 'Not started'
                : dcr.status === 'draft'
                  ? 'Draft'
                  : dcr.status === 'submitted'
                    ? 'Submitted'
                    : 'Locked'}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dcr-date">Date</Label>
          <Input
            id="dcr-date"
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="w-44"
          />
        </div>
      </div>

      {dateClosed && today && dcr?.status !== 'submitted' && dcr?.status !== 'locked' && (
        <p className="rounded-xl border bg-muted/40 p-4 text-sm" data-testid="dcr-date-closed">
          {dcrDateClosedText(date, today)}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {planned && !locked && (
        <p className="af-enter border-l-2 border-accent pl-3 text-sm" data-testid="dcr-planned">
          Prefilled from your approved tour plan:{' '}
          <span className="font-medium">
            {workTypes.find((w) => w.id === planned.workTypeId)?.name ?? '…'}
          </span>
          {planned.territoryIds[0] && (
            <>
              {' '}
              in <span className="font-medium">{byId.get(planned.territoryIds[0]) ?? '…'}</span>
            </>
          )}
          .
        </p>
      )}

      <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dcr-wt">Worked on</Label>
          <Select value={wt} onValueChange={setWt} disabled={locked}>
            <SelectTrigger id="dcr-wt" className="w-full" data-testid="dcr-wt">
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              {workTypes.length === 0 && (
                <EmptyOptions>No work types are set up yet. Ask your administrator.</EmptyOptions>
              )}
              {workTypes.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {field && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dcr-terr">Territory</Label>
            <Select value={terr} onValueChange={setTerr} disabled={locked}>
              <SelectTrigger id="dcr-terr" className="w-full" data-testid="dcr-terr">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {leaves.length === 0 && (
                  <EmptyOptions>
                    No territories are assigned to you yet. Ask your administrator.
                  </EmptyOptions>
                )}
                {leaves.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {territoryLabel(t, byId)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {deviates && (
          <div className="af-fade flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="dcr-reason">Why the change from your tour plan?</Label>
            <Input
              id="dcr-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              data-testid="dcr-reason"
              className="md:text-base"
            />
          </div>
        )}
      </fieldset>

      <section className="flex flex-col gap-3" aria-labelledby="dcr-calls">
        <div className="flex items-center justify-between gap-3">
          <h2 id="dcr-calls" className="text-base font-semibold">
            Calls <span className="text-muted-foreground tabular-nums">{calls.length}</span>
          </h2>
          {!locked && field && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAdding(true)}
              data-testid="dcr-add-call"
            >
              <Plus /> Add call
            </Button>
          )}
        </div>
        {calls.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {field ? 'No calls yet.' : 'Calls are only recorded on field days.'}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {calls.map((c) => (
              <li
                key={c.clientId}
                className="af-enter flex items-start justify-between gap-3 px-3 py-2.5"
                data-testid="dcr-call"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {outletName.get(c.outletId) ?? KIND_LABEL[c.outletKind]}
                    {c.outletKind !== 'doctor' && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        {KIND_LABEL[c.outletKind]}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {timeIST(c.calledAt)}
                    {c.productsDetailed.length > 0 &&
                      ` · Detailed ${c.productsDetailed.map((p) => productName.get(p.productId) ?? '…').join(', ')}`}
                    {c.samples.length > 0 &&
                      ` · Samples ${c.samples.map((s) => `${productName.get(s.productId) ?? '…'} ×${s.quantity}`).join(', ')}`}
                  </p>
                  {c.pob.length > 0 && (
                    <p className="text-xs" data-testid="dcr-call-pob">
                      {pobSummary(c.pob)}
                    </p>
                  )}
                  {c.rcpa.length > 0 && (
                    <p className="text-xs text-muted-foreground" data-testid="dcr-call-rcpa">
                      RCPA {c.rcpa.length} line{c.rcpa.length > 1 ? 's' : ''}
                    </p>
                  )}
                  {c.remarks && <p className="mt-0.5 text-xs">{c.remarks}</p>}
                </div>
                {!locked && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove call"
                    onClick={() => setCalls((cs) => cs.filter((x) => x.clientId !== c.clientId))}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!locked && (
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <ul className="text-sm text-muted-foreground" data-testid="dcr-problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={saving || !wt}
              onClick={() => save(false)}
              data-testid="dcr-save"
            >
              Save draft
            </Button>
            <Button
              disabled={saving || problems.length > 0}
              onClick={() => save(true)}
              data-testid="dcr-submit"
            >
              Submit
            </Button>
          </div>
        </div>
      )}

      <CallDialog
        open={adding}
        territoryId={field ? terr : ''}
        stockists={stockists}
        products={products}
        orderProducts={orderProducts}
        onClose={() => setAdding(false)}
        onAdd={(c, name) => {
          setPickedNames((m) => new Map(m).set(c.outletId, name));
          setCalls((cs) => [...cs, c]);
          setAdding(false);
        }}
      />
    </div>
  );
}

function CallDialog({
  open,
  territoryId,
  stockists,
  products,
  orderProducts,
  onClose,
  onAdd,
}: {
  open: boolean;
  territoryId: string;
  stockists: Opt[];
  products: PickProduct[];
  orderProducts: Opt[];
  onClose: () => void;
  onAdd: (c: Call, name: string) => void;
}) {
  const [kind, setKind] = useState<Kind>('doctor');
  const [doctorId, setDoctorId] = useState('');
  const [pickedName, setPickedName] = useState('');
  const [area, setArea] = useState(territoryId);
  useEffect(() => {
    if (open) setArea(territoryId);
  }, [open, territoryId]);
  const [pob, setPob] = useState<PobDraft[]>([]);
  const [rcpa, setRcpa] = useState<RcpaDraft[]>([]);
  const [detailed, setDetailed] = useState<string[]>([]);
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState('');
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const hit = t
      ? products.filter(
          (p) => p.name.toLowerCase().includes(t) || p.detail?.toLowerCase().includes(t),
        )
      : products;
    // Picked products stay visible, in detailing order, ahead of the rest.
    const picked = detailed
      .map((id) => products.find((p) => p.id === id))
      .filter(Boolean) as PickProduct[];
    return [...picked, ...hit.filter((p) => !detailed.includes(p.id)).slice(0, 24)];
  }, [q, products, detailed]);
  useEffect(() => {
    if (!open) return;
    setQ('');
    setKind('doctor');
    setDoctorId('');
    setPob([]);
    setRcpa([]);
    setDetailed([]);
    setSamples({});
    setRemarks('');
  }, [open]);
  const toggle = (id: string) =>
    setDetailed((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dcr-call-dialog" className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add call</DialogTitle>
          <DialogDescription>
            Who you met, what you detailed, samples, orders and prescription audit.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="call-kind">Call on</Label>
              <Select
                value={kind}
                onValueChange={(v) => {
                  setKind(v as Kind);
                  setDoctorId('');
                  if (v !== 'chemist') setRcpa([]);
                }}
              >
                <SelectTrigger id="call-kind" className="w-full" data-testid="call-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <TerritoryFilter value={area} onChange={setArea} testId="call-area" />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>{KIND_LABEL[kind]}</Label>
              <OutletPicker
                kind={kind}
                territoryId={area}
                value={doctorId ? [doctorId] : []}
                onChange={(ids, picked) => {
                  setDoctorId(ids[0] ?? '');
                  setPickedName(picked[0]?.name ?? '');
                }}
                testId="call-doctor"
                forReporting
              />
            </div>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">Products detailed, in order</legend>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${products.length} products`}
              aria-label="Search products"
              className="md:text-base"
              data-testid="call-product-search"
            />
            <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
              {shown.map((p) => {
                const n = detailed.indexOf(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={n >= 0}
                    onClick={() => toggle(p.id)}
                    data-testid="call-product"
                    title={p.detail ?? undefined}
                    className={cn(
                      'inline-flex items-center rounded-full border px-3 py-1 text-sm transition-[transform,background-color] duration-150 active:scale-[0.97]',
                      p.imageUrl && 'gap-1.5 pl-1',
                      n >= 0
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'hover:bg-muted',
                    )}
                  >
                    {p.imageUrl && (
                      <ProductImg
                        src={p.imageUrl}
                        alt=""
                        width={24}
                        height={24}
                        sizes="24px"
                        className="size-6 shrink-0 rounded-full bg-muted object-cover"
                        data-testid="call-product-image"
                      />
                    )}
                    {n >= 0 && <span className="mr-1 tabular-nums">{n + 1}.</span>}
                    {p.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {products.some((p) => p.isSample && detailed.includes(p.id)) && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-medium">Samples given</legend>
              {products
                .filter((p) => p.isSample && detailed.includes(p.id))
                .map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3">
                    <Label htmlFor={`s-${p.id}`} className="font-normal">
                      {p.name}
                    </Label>
                    <Input
                      id={`s-${p.id}`}
                      inputMode="numeric"
                      className="w-24 text-right md:text-base"
                      value={samples[p.id] ?? ''}
                      onChange={(e) =>
                        setSamples((s) => ({
                          ...s,
                          [p.id]: e.target.value.replace(/\D/g, '').slice(0, 5),
                        }))
                      }
                      placeholder="0"
                    />
                  </div>
                ))}
            </fieldset>
          )}
          <PobEditor
            rows={pob}
            onChange={setPob}
            products={orderProducts}
            stockists={stockists}
            showStockist={kind !== 'stockist'}
          />
          {kind === 'chemist' && (
            <RcpaEditor rows={rcpa} onChange={setRcpa} products={orderProducts} />
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="call-remarks">Remarks</Label>
            <Input
              id="call-remarks"
              value={remarks}
              maxLength={1000}
              onChange={(e) => setRemarks(e.target.value)}
              className="md:text-base"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!doctorId}
            data-testid="call-add"
            onClick={() =>
              onAdd(
                {
                  clientId: crypto.randomUUID(),
                  outletKind: kind,
                  outletId: doctorId,
                  checkInId: null,
                  presentationOpenedAt: null,
                  jointWorkUserIds: [],
                  productsDetailed: detailed.map((productId, i) => ({ productId, order: i + 1 })),
                  samples: Object.entries(samples)
                    .filter(([id, q]) => Number(q) > 0 && detailed.includes(id))
                    .map(([productId, q]) => ({ productId, quantity: Number(q) })),
                  pob: pobPayload(pob),
                  rcpa: kind === 'chemist' ? rcpaPayload(rcpa) : [],
                  remarks: remarks.trim() || null,
                  calledAt: new Date().toISOString(),
                },
                pickedName,
              )
            }
          >
            Add call
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 422 VALIDATION details.doctorIds: rejected doctors can't be reported on a DCR. */
export function rejectedDoctorsMessage(
  details: unknown,
  name: (id: string) => string,
): string | null {
  const ids = (details as { doctorIds?: unknown } | null)?.doctorIds;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  return `These doctors were rejected by a manager and can't be reported: ${ids.map((id) => name(String(id))).join(', ')}. Remove those calls and save again.`;
}
