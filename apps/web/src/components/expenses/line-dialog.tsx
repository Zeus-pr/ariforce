'use client';

import { useEffect, useId, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { EXPENSE_CATEGORIES, type ExpenseCategory, type ExpenseClaim } from '@ariforce/contracts';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import { api, apiReady } from '@/lib/api';
import { CATEGORY_LABEL, quietAbort, todayIST } from '@/lib/expenses/model';

type Line = ExpenseClaim['lines'][number];
export type LineDraft = {
  date: string;
  category: ExpenseCategory;
  amount: number;
  notes: string | null;
  mileageKm: number | null;
  dcrId: string | null;
  tourPlanId: string | null;
};

/** Add or edit one line. Links to the user's own DCR for that day and tour plan for the month are optional. */
export function LineDialog({
  open,
  month,
  line,
  onClose,
  onSave,
}: {
  open: boolean;
  month: string;
  line: Line | null;
  onClose: () => void;
  onSave: (d: LineDraft) => Promise<string | null>;
}) {
  const uid = useId();
  const first = `${month}-01`;
  const last = (() => {
    const t = todayIST();
    const end = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0))
      .toISOString()
      .slice(0, 10);
    return t < end ? t : end;
  })();
  const [date, setDate] = useState(last);
  const [category, setCategory] = useState<ExpenseCategory | ''>('');
  const [amount, setAmount] = useState('');
  const [km, setKm] = useState('');
  const [notes, setNotes] = useState('');
  const [linkDcr, setLinkDcr] = useState(false);
  const [linkTp, setLinkTp] = useState(false);
  const [dcrFor, setDcrFor] = useState<{ date: string; id: string | null } | null>(null);
  const [tpId, setTpId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(line?.date ?? last);
    setCategory(line?.category ?? '');
    setAmount(line ? String(line.amount) : '');
    setKm(line?.mileageKm != null ? String(line.mileageKm) : '');
    setNotes(line?.notes ?? '');
    setLinkDcr(!!line?.dcrId);
    setLinkTp(!!line?.tourPlanId);
    setError(null);
  }, [open, line, last]);

  // Find the user's DCR for the chosen day and the tour plan for the month (both optional links).
  useEffect(() => {
    if (!open || !date) return;
    const ac = new AbortController();
    quietAbort(
      ac.signal,
      (async () => {
        await apiReady();
        const r = await api.GET('/v1/dcrs', {
          params: { query: { from: date, to: date, limit: 5 } },
          signal: ac.signal,
        });
        if (!ac.signal.aborted)
          setDcrFor({ date, id: r.data?.items.find((d) => d.date === date)?.id ?? null });
      })(),
    );
    return () => ac.abort();
  }, [open, date]);
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    quietAbort(
      ac.signal,
      (async () => {
        await apiReady();
        const r = await api.GET('/v1/tour-plans/{month}', {
          params: { path: { month } },
          signal: ac.signal,
        });
        if (!ac.signal.aborted) setTpId(r.data?.id ?? null);
      })(),
    );
    return () => ac.abort();
  }, [open, month]);

  const amt = Number(amount);
  const kmN = Number(km);
  const problems = [
    !category && 'Choose a category.',
    (!date || date < first || date > last) && `Pick a date in ${month} up to today.`,
    !(amt > 0) && 'Enter an amount above zero.',
    amount.includes('.') && amount.split('.')[1]!.length > 2 && 'Use at most 2 decimals.',
    category === 'mileage' && !(kmN > 0 && kmN <= 5000) && 'Enter the kilometres (up to 5000).',
  ].filter(Boolean) as string[];
  const dcrId = linkDcr && dcrFor?.date === date ? dcrFor.id : null;

  async function save() {
    if (problems.length || !category) return;
    setBusy(true);
    const err = await onSave({
      date,
      category,
      amount: Math.round(amt * 100) / 100,
      notes: notes.trim() || null,
      mileageKm: category === 'mileage' ? kmN : null,
      dcrId,
      tourPlanId: linkTp ? (tpId ?? null) : null,
    });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="exp-line-dialog">
        <DialogHeader>
          <DialogTitle>{line ? 'Edit line' : 'Add a line'}</DialogTitle>
          <DialogDescription>One expense: what, when and how much.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-date`}>Date</Label>
            <Input
              id={`${uid}-date`}
              type="date"
              min={first}
              max={last}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              data-testid="exp-line-date"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-cat`}>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
              <SelectTrigger id={`${uid}-cat`} className="w-full" data-testid="exp-line-category">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-amt`}>Amount (₹)</Label>
            <Input
              id={`${uid}-amt`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0.00"
              data-testid="exp-line-amount"
            />
          </div>
          {category === 'mileage' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-km`}>Kilometres</Label>
              <Input
                id={`${uid}-km`}
                inputMode="decimal"
                value={km}
                onChange={(e) => setKm(e.target.value.replace(/[^\d.]/g, ''))}
                data-testid="exp-line-km"
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor={`${uid}-notes`}>Notes</Label>
            <textarea
              id={`${uid}-notes`}
              rows={2}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
              data-testid="exp-line-notes"
            />
          </div>
          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">Link (optional)</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-foreground"
                checked={linkDcr}
                disabled={!dcrFor?.id || dcrFor.date !== date}
                onChange={(e) => setLinkDcr(e.target.checked)}
                data-testid="exp-line-link-dcr"
              />
              {dcrFor?.date === date && dcrFor.id ? 'My DCR for this day' : 'No DCR for this day'}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-foreground"
                checked={linkTp}
                disabled={!tpId}
                onChange={(e) => setLinkTp(e.target.checked)}
                data-testid="exp-line-link-tp"
              />
              {tpId ? 'My tour plan for this month' : 'No tour plan for this month'}
            </label>
          </fieldset>
        </div>
        {(error || (problems.length > 0 && (amount || category))) && (
          <p role="alert" className="text-sm text-red-700" data-testid="exp-line-problems">
            {error ?? problems[0]}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || problems.length > 0} data-testid="exp-line-save">
            {busy && <LoaderCircle className="animate-spin" aria-hidden />}
            {line ? 'Save line' : 'Add line'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
