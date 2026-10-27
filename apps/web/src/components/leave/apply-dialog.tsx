'use client';

import { useMemo, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { LeaveBalanceItem, LeaveSettings, LeaveType } from '@/lib/leave/model';
import { Button } from '@ariforce/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@ariforce/ui/components/dialog';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ariforce/ui/components/select';
import { toast } from '@ariforce/ui/components/sonner';
import { EmptyOptions } from '@/components/forms/empty-options';
import { api, toApiError } from '@/lib/api';
import { addDays, countDays, dateLabel, daysLabel, leaveMessage, today } from '@/lib/leave/model';

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  types: LeaveType[];
  settings: LeaveSettings | null;
  balances: LeaveBalanceItem[];
  onApplied: () => void;
};

const FULL = 'full';

export function ApplyLeaveDialog({ open, onOpenChange, types, settings, balances, onApplied }: Props) {
  const t0 = today();
  const backdate = settings?.backdateDays ?? 14;
  const earliest = addDays(t0, -backdate);
  const latest = settings?.maxFutureDays != null ? addDays(t0, settings.maxFutureDays) : `${t0.slice(0, 4)}-12-31`;
  const weeklyOff = settings?.weeklyOffDays ?? [0];

  const [code, setCode] = useState('');
  const [from, setFrom] = useState(t0);
  const [to, setTo] = useState(t0);
  const [half, setHalf] = useState<string>(FULL);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const type = types.find((t) => t.code === code);
  const bal = balances.find((b) => b.typeCode === code);
  const single = from === to;
  const h = single && half !== FULL && type?.halfDayAllowed ? (half as 'am' | 'pm') : null;
  const days = countDays(from, to, h, weeklyOff);
  const after = bal && bal.available !== null ? bal.available - days : null;

  const problem = useMemo(() => {
    if (!code) return 'Choose a leave type.';
    if (!from || !to) return 'Choose the dates.';
    if (to < from) return 'The end date is before the start date.';
    if (from < earliest) return `Leave can start no earlier than ${dateLabel(earliest)} (${backdate} days back).`;
    if (from > latest) return `Leave can start no later than ${dateLabel(latest)}.`;
    if (from.slice(0, 4) !== to.slice(0, 4)) return 'Leave cannot cross 31 December. Split it into two requests.';
    if (days === 0) return 'Every selected date is a weekly off.';
    if (after !== null && after < 0) return `Not enough balance: ${bal!.available} available, ${days} requested.`;
    return null;
  }, [code, from, to, earliest, latest, backdate, days, after, bal]);

  function reset() {
    setCode('');
    setFrom(t0);
    setTo(t0);
    setHalf(FULL);
    setReason('');
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const r = await api.POST('/v1/leave/requests', {
      body: { typeCode: code, fromDate: from, toDate: to, half: h, reason: reason.trim() || null },
    });
    setBusy(false);
    if (r.error) return setError(leaveMessage(toApiError(r)));
    toast.success(`Leave requested: ${daysLabel(r.data.days)}`);
    reset();
    onOpenChange(false);
    onApplied();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : (reset(), onOpenChange(o)))}>
      <DialogContent className="sm:max-w-md" data-testid="leave-apply-dialog">
        <DialogHeader>
          <DialogTitle>Apply for leave</DialogTitle>
          <DialogDescription>
            Your manager approves it{settings && settings.approvalLevels > 1 ? `, then their manager` : ''}. You can backdate up to {backdate} days.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="leave-type">Leave type</Label>
            <Select value={code} onValueChange={(v) => (setCode(v), setError(null))}>
              <SelectTrigger id="leave-type" data-testid="leave-type" className="w-full">
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                {types.length === 0 && <EmptyOptions>No leave types are set up yet. Ask your administrator.</EmptyOptions>}
                {types.map((t) => {
                  const b = balances.find((x) => x.typeCode === t.code);
                  return (
                    <SelectItem key={t.code} value={t.code}>
                      {t.name}
                      <span className="ml-2 text-muted-foreground">{b?.available == null ? (b ? 'no limit' : '') : `${b.available} left`}</span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="leave-from">From</Label>
              <Input
                id="leave-from"
                data-testid="leave-from"
                type="date"
                min={earliest}
                max={latest}
                value={from}
                onChange={(e) => {
                  const v = e.target.value;
                  setFrom(v);
                  if (!to || to < v) setTo(v);
                  setError(null);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="leave-to">To</Label>
              <Input id="leave-to" data-testid="leave-to" type="date" min={from} value={to} onChange={(e) => (setTo(e.target.value), setError(null))} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="leave-half">Duration</Label>
            <Select value={single && type?.halfDayAllowed !== false ? half : FULL} onValueChange={setHalf} disabled={!single || type?.halfDayAllowed === false}>
              <SelectTrigger id="leave-half" data-testid="leave-half" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FULL}>{single ? 'Full day' : 'Full days'}</SelectItem>
                <SelectItem value="am">Half day, morning</SelectItem>
                <SelectItem value="pm">Half day, afternoon</SelectItem>
              </SelectContent>
            </Select>
            {!single && <p className="text-xs text-muted-foreground">Half days are for a single date.</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="leave-reason">Reason (optional)</Label>
            <textarea
              id="leave-reason"
              data-testid="leave-reason"
              maxLength={1000}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
            />
          </div>
          <div className="rounded-md bg-muted/60 px-3 py-2 text-sm" data-testid="leave-summary" aria-live="polite">
            <span className="font-medium tabular-nums" data-testid="leave-days">{daysLabel(days)}</span>
            {weeklyOff.length > 0 && !single && <span className="text-muted-foreground"> (weekly offs not counted)</span>}
            {type && (
              <span className="block text-muted-foreground" data-testid="leave-balance-after">
                {bal?.available == null
                  ? `${type.name}: no limit`
                  : `${type.name}: ${bal.available} available, ${after} left after this`}
              </span>
            )}
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert" data-testid="leave-apply-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} data-testid="leave-submit">
              {busy && <LoaderCircle className="animate-spin" />}Send for approval
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
