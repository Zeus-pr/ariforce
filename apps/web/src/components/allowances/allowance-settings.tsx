'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AllowancePlace, AllowanceRate } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@ariforce/ui/components/dialog';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ariforce/ui/components/select';
import { toast } from '@ariforce/ui/components/sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ariforce/ui/components/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ariforce/ui/components/tabs';
import { LookupsProvider, useLookups } from '@/components/masters/lookups';
import { BAND_LABEL } from '@/components/expenses/allowance-dialog';
import { api, apiReady, toApiError } from '@/lib/api';
import { money } from '@/lib/expenses/model';
import { ROLES, ROLE_LABEL } from '@/lib/roles';

const ALL = '__all';
export function settingsMessage(code?: string, message?: string): string {
  if (code === 'DUPLICATE_RATE') return 'A rate for this band, role and start date already exists.';
  if (code === 'DUPLICATE_PLACE') return 'This place already exists for that HQ.';
  if (code === 'VERSION_CONFLICT') return 'Changed by someone else. Close and reopen to see the latest.';
  if (code === 'NOT_HQ_TERRITORY') return 'Choose a headquarter territory.';
  if (code === 'FORBIDDEN') return 'Only System Admin and Director can change TA/DA settings.';
  return message || 'Could not save. Try again.';
}
const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
const okMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim()) && Number(v) <= 1_000_000;

export function AllowanceSettings() {
  return (
    <LookupsProvider>
      <Tabs defaultValue="rates">
        <TabsList>
          <TabsTrigger value="rates" data-testid="alw-tab-rates">Rate card</TabsTrigger>
          <TabsTrigger value="places" data-testid="alw-tab-places">Places</TabsTrigger>
        </TabsList>
        <TabsContent value="rates"><Rates /></TabsContent>
        <TabsContent value="places"><Places /></TabsContent>
      </Tabs>
    </LookupsProvider>
  );
}

type RateForm = { id?: string; version?: number; band: string; roleKey: string; effectiveFrom: string; daAmount: string; taPerKm: string; taFixed: string };

function Rates() {
  const [items, setItems] = useState<AllowanceRate[] | null>(null);
  const [band, setBand] = useState(ALL);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<RateForm | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    await apiReady();
    const r = await api.GET('/v1/allowance-rates', { params: { query: band === ALL ? {} : { band: band as AllowanceRate['band'] } } });
    if (!r.data) return setError(settingsMessage(toApiError(r).code, toApiError(r).message));
    setError(null);
    setItems(r.data.items);
  }, [band]);
  useEffect(() => void load(), [load]);

  async function save() {
    if (!form) return;
    if (![form.daAmount, form.taPerKm, form.taFixed].every(okMoney)) return setFormErr('Amounts must be numbers from 0 to 10,00,000 with at most 2 decimals.');
    if (!form.effectiveFrom) return setFormErr('Choose the date the rate starts.');
    const body = { band: form.band as AllowanceRate['band'], roleKey: form.roleKey === ALL ? null : (form.roleKey as AllowanceRate['roleKey']), effectiveFrom: form.effectiveFrom, daAmount: num(form.daAmount), taPerKm: num(form.taPerKm), taFixed: num(form.taFixed) };
    const r = form.id
      ? await api.PUT('/v1/allowance-rates/{id}', { params: { path: { id: form.id } }, body: { ...body, version: form.version! } })
      : await api.POST('/v1/allowance-rates', { body });
    if (r.error) return setFormErr(settingsMessage(toApiError(r).code, toApiError(r).message));
    toast.success(form.id ? 'Rate saved' : 'Rate added');
    setForm(null);
    void load();
  }
  async function remove(x: AllowanceRate) {
    const r = await api.DELETE('/v1/allowance-rates/{id}', { params: { path: { id: x.id } } });
    if (r.error) return toast.error(settingsMessage(toApiError(r).code, toApiError(r).message));
    toast.success('Rate deleted');
    void load();
  }
  const open = (x?: AllowanceRate) => {
    setFormErr(null);
    setForm(x ? { id: x.id, version: x.version, band: x.band, roleKey: x.roleKey ?? ALL, effectiveFrom: x.effectiveFrom, daAmount: String(x.daAmount), taPerKm: String(x.taPerKm), taFixed: String(x.taFixed) } : { band: 'hq', roleKey: ALL, effectiveFrom: '', daAmount: '', taPerKm: '0', taFixed: '0' });
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Select value={band} onValueChange={setBand}>
          <SelectTrigger className="w-44" aria-label="Band" data-testid="rate-band-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All bands</SelectItem>{Object.entries(BAND_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" onClick={() => open()} data-testid="rate-add"><Plus /> Add rate</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {items?.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="rate-empty">No rates yet. Add one rate per band so allowances can be worked out.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Band</TableHead><TableHead>Role</TableHead><TableHead>From</TableHead><TableHead className="text-right">DA / day</TableHead><TableHead className="text-right">TA / km</TableHead><TableHead className="text-right">Flat TA</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {(items ?? []).map((x) => (
                <TableRow key={x.id} data-testid="rate-row">
                  <TableCell>{BAND_LABEL[x.band]}</TableCell>
                  <TableCell>{x.roleKey ? ROLE_LABEL[x.roleKey as keyof typeof ROLE_LABEL] ?? x.roleKey : 'All roles'}</TableCell>
                  <TableCell>{x.effectiveFrom}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(x.daAmount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(x.taPerKm)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(x.taFixed)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="icon" variant="ghost" aria-label="Edit rate" onClick={() => open(x)} data-testid="rate-edit"><Pencil /></Button>
                    <Button size="icon" variant="ghost" aria-label="Delete rate" onClick={() => void remove(x)} data-testid="rate-delete"><Trash2 /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent data-testid="rate-dialog">
          <DialogHeader><DialogTitle>{form?.id ? 'Edit rate' : 'Add rate'}</DialogTitle></DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5"><Label>Band</Label>
                <Select value={form.band} onValueChange={(v) => setForm({ ...form, band: v })}><SelectTrigger className="w-full" data-testid="rate-band"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(BAND_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="flex flex-col gap-1.5"><Label>Role</Label>
                <Select value={form.roleKey} onValueChange={(v) => setForm({ ...form, roleKey: v })}><SelectTrigger className="w-full" data-testid="rate-role"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>All roles</SelectItem>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="rate-from">Starts on</Label><Input id="rate-from" type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} data-testid="rate-from" /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="rate-da">DA per day (₹)</Label><Input id="rate-da" inputMode="decimal" value={form.daAmount} onChange={(e) => setForm({ ...form, daAmount: e.target.value })} data-testid="rate-da" /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="rate-km">TA per km (₹)</Label><Input id="rate-km" inputMode="decimal" value={form.taPerKm} onChange={(e) => setForm({ ...form, taPerKm: e.target.value })} data-testid="rate-km" /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="rate-fixed">Flat TA per day (₹)</Label><Input id="rate-fixed" inputMode="decimal" value={form.taFixed} onChange={(e) => setForm({ ...form, taFixed: e.target.value })} data-testid="rate-fixed" /></div>
            </div>
          )}
          {formErr && <p role="alert" className="text-sm text-destructive" data-testid="rate-error">{formErr}</p>}
          <DialogFooter><Button variant="outline" onClick={() => setForm(null)}>Cancel</Button><Button onClick={() => void save()} data-testid="rate-save">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type PlaceForm = { id?: string; version?: number; hqTerritoryId: string; name: string; band: string; oneWayKm: string; active: boolean };

function Places() {
  const { territories } = useLookups();
  const [items, setItems] = useState<AllowancePlace[] | null>(null);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [inactive, setInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<PlaceForm | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const load = useCallback(async () => {
    await apiReady();
    const r = await api.GET('/v1/allowance-places', { params: { query: { ...(dq ? { q: dq } : {}), ...(inactive ? { includeInactive: 'true' as const } : {}) } } });
    if (!r.data) return setError(settingsMessage(toApiError(r).code, toApiError(r).message));
    setError(null);
    setItems(r.data.items);
  }, [dq, inactive]);
  useEffect(() => void load(), [load]);

  async function save() {
    if (!form) return;
    const km = Number(form.oneWayKm);
    if (!form.hqTerritoryId) return setFormErr('Choose the HQ.');
    if (!form.name.trim()) return setFormErr('Enter the place name.');
    if (!/^\d+(\.\d{1,2})?$/.test(form.oneWayKm.trim()) || km <= 0 || km > 2500) return setFormErr('One-way distance must be more than 0 and at most 2,500 km.');
    const body = { hqTerritoryId: form.hqTerritoryId, name: form.name.trim(), band: form.band as AllowancePlace['band'], oneWayKm: km, active: form.active };
    const r = form.id
      ? await api.PUT('/v1/allowance-places/{id}', { params: { path: { id: form.id } }, body: { ...body, version: form.version! } })
      : await api.POST('/v1/allowance-places', { body });
    if (r.error) return setFormErr(settingsMessage(toApiError(r).code, toApiError(r).message));
    toast.success(form.id ? 'Place saved' : 'Place added');
    setForm(null);
    void load();
  }
  async function remove(x: AllowancePlace) {
    const r = await api.DELETE('/v1/allowance-places/{id}', { params: { path: { id: x.id } } });
    if (r.error) return toast.error(settingsMessage(toApiError(r).code, toApiError(r).message));
    toast.success('Place removed');
    void load();
  }
  const open = (x?: AllowancePlace) => {
    setFormErr(null);
    setForm(x ? { id: x.id, version: x.version, hqTerritoryId: x.hqTerritoryId, name: x.name, band: x.band, oneWayKm: String(x.oneWayKm), active: x.active } : { hqTerritoryId: '', name: '', band: 'ex_hq', oneWayKm: '', active: true });
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Input aria-label="Search places" placeholder="Search places" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs md:text-base" data-testid="place-search" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={inactive} onChange={(e) => setInactive(e.target.checked)} data-testid="place-inactive" /> Show removed places</label>
        <Button size="sm" className="ml-auto" onClick={() => open()} data-testid="place-add"><Plus /> Add place</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {items?.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="place-empty">{dq ? 'No places match.' : 'No places yet. Add the towns reps travel to from each HQ, with the one-way distance.'}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Place</TableHead><TableHead>HQ</TableHead><TableHead>Band</TableHead><TableHead className="text-right">One way</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {(items ?? []).map((x) => (
                <TableRow key={x.id} data-testid="place-row" className={x.active ? '' : 'text-muted-foreground'}>
                  <TableCell>{x.name}{!x.active && ' (removed)'}</TableCell>
                  <TableCell>{x.hqName}</TableCell>
                  <TableCell>{BAND_LABEL[x.band]}</TableCell>
                  <TableCell className="text-right tabular-nums">{x.oneWayKm} km</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="icon" variant="ghost" aria-label="Edit place" onClick={() => open(x)} data-testid="place-edit"><Pencil /></Button>
                    {x.active && <Button size="icon" variant="ghost" aria-label="Remove place" onClick={() => void remove(x)} data-testid="place-delete"><Trash2 /></Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent data-testid="place-dialog">
          <DialogHeader><DialogTitle>{form?.id ? 'Edit place' : 'Add place'}</DialogTitle></DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5"><Label>HQ</Label>
                <Select value={form.hqTerritoryId} onValueChange={(v) => setForm({ ...form, hqTerritoryId: v })}><SelectTrigger className="w-full" data-testid="place-hq"><SelectValue placeholder="Choose" /></SelectTrigger><SelectContent>{territories.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="flex flex-col gap-1.5"><Label>Band</Label>
                <Select value={form.band} onValueChange={(v) => setForm({ ...form, band: v })}><SelectTrigger className="w-full" data-testid="place-band"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ex_hq">Ex-HQ</SelectItem><SelectItem value="outstation">Outstation</SelectItem></SelectContent></Select>
              </div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="place-name">Place</Label><Input id="place-name" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="place-name" /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="place-km">One-way km</Label><Input id="place-km" inputMode="decimal" value={form.oneWayKm} onChange={(e) => setForm({ ...form, oneWayKm: e.target.value })} data-testid="place-km" /></div>
              {form.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>}
            </div>
          )}
          {formErr && <p role="alert" className="text-sm text-destructive" data-testid="place-error">{formErr}</p>}
          <DialogFooter><Button variant="outline" onClick={() => setForm(null)}>Cancel</Button><Button onClick={() => void save()} data-testid="place-save">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
