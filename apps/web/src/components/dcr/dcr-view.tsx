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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ariforce/ui/components/select';
import { toast } from '@ariforce/ui/components/sonner';
import { cn } from '@ariforce/ui/lib/utils';
import { dateLabel, timeIST, todayIST } from '@/components/attendance/format';
import { LookupsProvider, useLookups } from '@/components/masters/lookups';
import { api, apiReady, MOCKING, toApiError } from '@/lib/api';
import { saveMessage } from '@/lib/leave/model';
import { MOCK_PRODUCT_SEED } from '@/mocks/product-seed';

/** What the call form needs from a product. */
type PickProduct = { id: string; name: string; detail: string | null; isSample: boolean };

/** In mock mode the picker uses Arighna's real product names (local mock seed); live mode uses GET /v1/products. */
const SEED_PRODUCTS: PickProduct[] = MOCK_PRODUCT_SEED.map((p) => ({ id: p.id, name: p.name, detail: p.composition, isSample: true }));

type Call = Omit<Dcr['calls'][number], 'id'> & { clientId: string };
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
      const [w, d, p] = await Promise.all([
        api.GET('/v1/work-types', { params: { query: { limit: 100 } } }),
        api.GET('/v1/doctors', { params: { query: { limit: 100, sort: 'name' } } }),
        api.GET('/v1/products', { params: { query: { limit: 200 } } }),
      ]);
      if (w.data) setWorkTypes(w.data.items.filter((x) => x.active));
      if (d.data) setDoctors(d.data.items);
      if (MOCKING) setProducts(SEED_PRODUCTS);
      else if (p.data) setProducts(p.data.items.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name, detail: x.composition, isSample: x.isSample })));
    })();
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
    const plan = tp.data?.status === 'approved' ? (tp.data.days.find((x) => x.date === date)?.entries[0] ?? null) : null;
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
  const deviates = !!planned && (planned.workTypeId !== wt || (field && (planned.territoryIds[0] ?? '') !== terr));
  const locked = dcr?.status === 'submitted' || dcr?.status === 'locked';
  const doctorName = useMemo(() => new Map(doctors.map((d) => [d.id, d.name])), [doctors]);
  const productName = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);
  const leaves = territories.filter((t) => !territories.some((c) => c.parentId === t.id));

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
        calls,
        submit,
        ...(dcr ? { version: dcr.version } : {}),
      },
    });
    setSaving(false);
    if (r.error) return toast.error(saveMessage(toApiError(r)), { duration: 10000 });
    setDcr(r.data);
    toast.success(submit ? `DCR for ${dateLabel(date)} submitted` : 'Draft saved');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold" data-testid="dcr-date-label">{dateLabel(date)}</h2>
          <p className="text-sm text-muted-foreground" data-testid="dcr-status">
            {dcr === undefined ? 'Loading…' : !dcr ? 'Not started' : dcr.status === 'draft' ? 'Draft' : dcr.status === 'submitted' ? 'Submitted' : 'Locked'}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dcr-date">Date</Label>
          <Input id="dcr-date" type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" />
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {planned && !locked && (
        <p className="af-enter border-l-2 border-accent pl-3 text-sm" data-testid="dcr-planned">
          Prefilled from your approved tour plan: <span className="font-medium">{workTypes.find((w) => w.id === planned.workTypeId)?.name ?? '…'}</span>
          {planned.territoryIds[0] && <> in <span className="font-medium">{byId.get(planned.territoryIds[0]) ?? '…'}</span></>}.
        </p>
      )}

      <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dcr-wt">Worked on</Label>
          <Select value={wt} onValueChange={setWt} disabled={locked}>
            <SelectTrigger id="dcr-wt" className="w-full" data-testid="dcr-wt"><SelectValue placeholder="Choose" /></SelectTrigger>
            <SelectContent>{workTypes.length === 0 && <EmptyOptions>No work types are set up yet. Ask your administrator.</EmptyOptions>}{workTypes.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {field && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dcr-terr">Territory</Label>
            <Select value={terr} onValueChange={setTerr} disabled={locked}>
              <SelectTrigger id="dcr-terr" className="w-full" data-testid="dcr-terr"><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>{leaves.length === 0 && <EmptyOptions>No territories are assigned to you yet. Ask your administrator.</EmptyOptions>}{leaves.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {deviates && (
          <div className="af-fade flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="dcr-reason">Why the change from your tour plan?</Label>
            <Input id="dcr-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="dcr-reason" className="md:text-base" />
          </div>
        )}
      </fieldset>

      <section className="flex flex-col gap-3" aria-labelledby="dcr-calls">
        <div className="flex items-center justify-between gap-3">
          <h2 id="dcr-calls" className="text-base font-semibold">Calls <span className="text-muted-foreground tabular-nums">{calls.length}</span></h2>
          {!locked && field && (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)} data-testid="dcr-add-call">
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
              <li key={c.clientId} className="af-enter flex items-start justify-between gap-3 px-3 py-2.5" data-testid="dcr-call">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{doctorName.get(c.outletId) ?? 'Doctor'}</p>
                  <p className="text-xs text-muted-foreground">
                    {timeIST(c.calledAt)}
                    {c.productsDetailed.length > 0 && ` · Detailed ${c.productsDetailed.map((p) => productName.get(p.productId) ?? '…').join(', ')}`}
                    {c.samples.length > 0 && ` · Samples ${c.samples.map((s) => `${productName.get(s.productId) ?? '…'} ×${s.quantity}`).join(', ')}`}
                  </p>
                  {c.remarks && <p className="mt-0.5 text-xs">{c.remarks}</p>}
                </div>
                {!locked && (
                  <Button variant="ghost" size="icon" aria-label="Remove call" onClick={() => setCalls((cs) => cs.filter((x) => x.clientId !== c.clientId))}>
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
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <div className="flex gap-2">
            <Button variant="outline" disabled={saving || !wt} onClick={() => save(false)} data-testid="dcr-save">Save draft</Button>
            <Button disabled={saving || problems.length > 0} onClick={() => save(true)} data-testid="dcr-submit">Submit</Button>
          </div>
        </div>
      )}

      <CallDialog
        open={adding}
        doctors={doctors}
        products={products}
        onClose={() => setAdding(false)}
        onAdd={(c) => {
          setCalls((cs) => [...cs, c]);
          setAdding(false);
        }}
      />
    </div>
  );
}

function CallDialog({
  open,
  doctors,
  products,
  onClose,
  onAdd,
}: {
  open: boolean;
  doctors: Doctor[];
  products: PickProduct[];
  onClose: () => void;
  onAdd: (c: Call) => void;
}) {
  const [doctorId, setDoctorId] = useState('');
  const [detailed, setDetailed] = useState<string[]>([]);
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState('');
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const hit = t ? products.filter((p) => p.name.toLowerCase().includes(t) || p.detail?.toLowerCase().includes(t)) : products;
    // Picked products stay visible, in detailing order, ahead of the rest.
    const picked = detailed.map((id) => products.find((p) => p.id === id)).filter(Boolean) as PickProduct[];
    return [...picked, ...hit.filter((p) => !detailed.includes(p.id)).slice(0, 24)];
  }, [q, products, detailed]);
  useEffect(() => {
    if (!open) return;
    setQ('');
    setDoctorId('');
    setDetailed([]);
    setSamples({});
    setRemarks('');
  }, [open]);
  const toggle = (id: string) => setDetailed((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dcr-call-dialog" className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add call</DialogTitle>
          <DialogDescription>Who you met, what you detailed, samples given.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="call-doctor">Doctor</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger id="call-doctor" className="w-full" data-testid="call-doctor"><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>{doctors.length === 0 && <EmptyOptions>No doctors in your territory yet. Ask your manager to add them.</EmptyOptions>}{doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
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
                      'rounded-full border px-3 py-1 text-sm transition-[transform,background-color] duration-150 active:scale-[0.97]',
                      n >= 0 ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
                    )}
                  >
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
              {products.filter((p) => p.isSample && detailed.includes(p.id)).map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3">
                  <Label htmlFor={`s-${p.id}`} className="font-normal">{p.name}</Label>
                  <Input
                    id={`s-${p.id}`}
                    inputMode="numeric"
                    className="w-24 text-right md:text-base"
                    value={samples[p.id] ?? ''}
                    onChange={(e) => setSamples((s) => ({ ...s, [p.id]: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
                    placeholder="0"
                  />
                </div>
              ))}
            </fieldset>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="call-remarks">Remarks</Label>
            <Input id="call-remarks" value={remarks} maxLength={1000} onChange={(e) => setRemarks(e.target.value)} className="md:text-base" />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!doctorId}
            data-testid="call-add"
            onClick={() =>
              onAdd({
                clientId: crypto.randomUUID(),
                outletKind: 'doctor',
                outletId: doctorId,
                checkInId: null,
                jointWorkUserIds: [],
                productsDetailed: detailed.map((productId, i) => ({ productId, order: i + 1 })),
                samples: Object.entries(samples)
                  .filter(([id, q]) => Number(q) > 0 && detailed.includes(id))
                  .map(([productId, q]) => ({ productId, quantity: Number(q) })),
                pob: [],
                remarks: remarks.trim() || null,
                calledAt: new Date().toISOString(),
              })
            }
          >
            Add call
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
