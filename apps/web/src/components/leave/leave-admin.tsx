'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { LeaveSettings, LeaveType } from '@/lib/leave/model';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ariforce/ui/components/select';
import { toast } from '@ariforce/ui/components/sonner';
import { EmptyOptions } from '@/components/forms/empty-options';
import { api, apiReady, toApiError } from '@/lib/api';
import { leaveMessage, today } from '@/lib/leave/model';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const box = 'rounded-lg border bg-card p-4 flex flex-col gap-4';

/** Company leave rules (settings:write). Types are listed read-only here. */
export function LeaveSettingsPanel({ settings, types, onSaved }: { settings: LeaveSettings; types: LeaveType[]; onSaved: () => void }) {
  const [levels, setLevels] = useState(String(settings.approvalLevels));
  const [back, setBack] = useState(String(settings.backdateDays));
  const [future, setFuture] = useState(settings.maxFutureDays == null ? '' : String(settings.maxFutureDays));
  const [off, setOff] = useState<number[]>(settings.weeklyOffDays);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const lv = Number(levels), bd = Number(back), fd = future === '' ? null : Number(future);
    if (!Number.isInteger(lv) || lv < 1 || lv > 5) return setError('Approval levels must be 1 to 5.');
    if (!Number.isInteger(bd) || bd < 0 || bd > 366) return setError('Backdating must be 0 to 366 days.');
    if (fd !== null && (!Number.isInteger(fd) || fd < 0 || fd > 731)) return setError('Advance limit must be 0 to 731 days, or empty.');
    setBusy(true);
    const r = await api.PUT('/v1/leave/settings', {
      body: { approvalLevels: lv, backdateDays: bd, maxFutureDays: fd, weeklyOffDays: [...off].sort(), version: settings.version },
    });
    setBusy(false);
    if (r.error) return setError(toApiError(r).code === 'VERSION_CONFLICT' ? 'Someone else changed these settings. Reload and try again.' : leaveMessage(toApiError(r)));
    setError(null);
    toast.success('Leave settings saved');
    onSaved();
  }

  return (
    <div className="flex flex-col gap-6">
      <form className={box} onSubmit={save} data-testid="leave-settings" noValidate>
        <h2 className="text-base font-semibold">Leave rules</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ls-levels">Approval levels</Label>
            <Input id="ls-levels" data-testid="ls-levels" inputMode="numeric" value={levels} onChange={(e) => setLevels(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ls-back">Backdating (days)</Label>
            <Input id="ls-back" data-testid="ls-back" inputMode="numeric" value={back} onChange={(e) => setBack(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ls-future">Apply ahead (days)</Label>
            <Input id="ls-future" inputMode="numeric" placeholder="Until 31 Dec" value={future} onChange={(e) => setFuture(e.target.value)} />
          </div>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Weekly off</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <label key={d} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input type="checkbox" checked={off.includes(i)} onChange={(e) => setOff((o) => (e.target.checked ? [...o, i] : o.filter((x) => x !== i)))} />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p className="text-sm text-destructive" role="alert" data-testid="ls-error">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={busy} data-testid="ls-save">
            {busy && <LoaderCircle className="animate-spin" />}Save rules
          </Button>
        </div>
      </form>
      <div className={box}>
        <h2 className="text-base font-semibold">Leave types</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="leave-types">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-4 font-medium">Type</th>
                <th className="py-1 pr-4 font-medium">Per year</th>
                <th className="py-1 pr-4 font-medium">Paid</th>
                <th className="py-1 pr-4 font-medium">Carry forward</th>
                <th className="py-1 font-medium">Half day</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {types.map((t) => (
                <tr key={t.code}>
                  <td className="py-2 pr-4">
                    {t.name} <span className="text-muted-foreground">{t.code}</span>
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{t.grantOnly ? 'Granted' : t.annualQuota == null ? 'No limit' : t.annualQuota}</td>
                  <td className="py-2 pr-4">{t.paid ? 'Yes' : 'No'}</td>
                  <td className="py-2 pr-4">{t.carryForward ? (t.carryForwardCap == null ? 'Yes' : `Up to ${t.carryForwardCap}`) : 'No'}</td>
                  <td className="py-2">{t.halfDayAllowed ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type Person = { id: string; name: string };

/** Grant comp-off, opening balances or adjustments to someone in your reporting line (leave:approve). */
export function LeaveGrantPanel({ types, selfId }: { types: LeaveType[]; selfId: string | null }) {
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [userId, setUserId] = useState('');
  const [code, setCode] = useState('COMP');
  const [kind, setKind] = useState<'grant' | 'opening' | 'adjustment'>('grant');
  const [days, setDays] = useState('1');
  const [worked, setWorked] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    const id = setTimeout(async () => {
      await apiReady();
      const r = await api
        .GET('/v1/users', { params: { query: { limit: 25, status: 'active', sort: 'name', ...(q.trim() ? { q: q.trim() } : {}) } }, signal: ac.signal })
        .catch(() => null);
      if (ac.signal.aborted || !r) return;
      setPeople((r.data?.items ?? []).filter((u) => u.id !== selfId).map((u) => ({ id: u.id, name: u.name })));
    }, 250);
    return () => (clearTimeout(id), ac.abort());
  }, [q, selfId]);

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    const d = Number(days);
    if (!userId) return setError('Choose a person.');
    if (!Number.isFinite(d) || d === 0 || (d * 2) % 1 !== 0 || (kind !== 'adjustment' && d < 0)) return setError('Days must be in steps of 0.5, above 0 (adjustments may be negative).');
    if (!reason.trim()) return setError('Add a reason.');
    setBusy(true);
    const r = await api.POST('/v1/leave/grants', {
      body: { userId, typeCode: code, year: Number(today().slice(0, 4)), kind, days: d, workedDate: worked || null, reason: reason.trim() },
    });
    setBusy(false);
    if (r.error) return setError(leaveMessage(toApiError(r)));
    setError(null);
    setReason('');
    setWorked('');
    toast.success(`Granted ${d} ${code} to ${people?.find((p) => p.id === userId)?.name ?? 'them'}`);
  }

  return (
    <form className={box} onSubmit={grant} data-testid="leave-grant" noValidate>
      <div>
        <h2 className="text-base font-semibold">Grant leave</h2>
        <p className="text-sm text-muted-foreground">Comp-off for a worked off day, an opening balance, or a correction.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lg-q">Find person</Label>
          <Input id="lg-q" type="search" placeholder="Name or code" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lg-person">Person</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger id="lg-person" data-testid="lg-person" className="w-full">
              <SelectValue placeholder={people === null ? 'Loading…' : 'Choose'} />
            </SelectTrigger>
            <SelectContent>
              {people?.length === 0 && <EmptyOptions>No one matches. Try another name.</EmptyOptions>}
              {people?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lg-type">Leave type</Label>
          <Select value={code} onValueChange={setCode}>
            <SelectTrigger id="lg-type" data-testid="lg-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t.code} value={t.code}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lg-kind">Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger id="lg-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="grant">Grant</SelectItem>
              <SelectItem value="opening">Opening balance</SelectItem>
              <SelectItem value="adjustment">Adjustment (+/−)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lg-days">Days</Label>
          <Input id="lg-days" data-testid="lg-days" inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lg-worked">Day worked (comp-off)</Label>
          <Input id="lg-worked" type="date" max={today()} value={worked} onChange={(e) => setWorked(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lg-reason">Reason</Label>
        <Input id="lg-reason" data-testid="lg-reason" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert" data-testid="lg-error">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={busy} data-testid="lg-save">
          {busy && <LoaderCircle className="animate-spin" />}Grant
        </Button>
      </div>
    </form>
  );
}
