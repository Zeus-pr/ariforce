'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Bus,
  Camera,
  Car,
  CircleEllipsis,
  LoaderCircle,
  Paperclip,
  Utensils,
  Wallet,
  X,
} from 'lucide-react';
import {
  EXPENSE_CATEGORIES,
  ExpenseLineInput,
  type ExpenseCategory,
  type ExpenseClaim,
} from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@ariforce/ui/components/dialog';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { cn } from '@ariforce/ui/lib/utils';
import { api, apiReady, MOCKING, toApiError } from '@/lib/api';
import {
  ACCEPT,
  CATEGORY_LABEL,
  checkFile,
  dayLabel,
  lastDayOf,
  messageFor,
  money,
  quietAbort,
  thisMonth,
  todayIST,
} from '@/lib/expenses/model';
import { uploadReceipt } from '@/lib/expenses/upload';

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

const ICON: Record<ExpenseCategory, typeof Bus> = {
  travel: Bus,
  hotel: BedDouble,
  food: Utensils,
  mileage: Car,
  allowance: Wallet,
  other: CircleEllipsis,
};
const STEPS = ['What & when', 'Amount', 'Review'] as const;

/**
 * Guided add/edit of one expense: type + date, amount (+ km, notes, receipt), review.
 * Without a claim, the month's claim is opened (or created) silently on save.
 */
export function ExpenseFlow({
  open,
  claim,
  line,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The claim to add to; null = the claim of the chosen date's month. */
  claim: Pick<ExpenseClaim, 'id' | 'month' | 'lines'> | null;
  line: Line | null;
  onClose: () => void;
  onSaved: (claimId: string, submit: boolean) => void;
}) {
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const month = claim?.month ?? null;
  const minDate = month ? `${month}-01` : undefined;
  const maxDate = month ? lastDayOf(month) : todayIST();
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [date, setDate] = useState(maxDate);
  const [amount, setAmount] = useState('');
  const [km, setKm] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [touched, setTouched] = useState(false);
  const [dcr, setDcr] = useState<{ date: string; id: string | null; status?: string } | null>(null);
  const [busy, setBusy] = useState<null | 'draft' | 'submit'>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(line ? 1 : 0);
    setCategory(line?.category ?? null);
    setDate(line?.date ?? maxDate);
    setAmount(line ? String(line.amount) : '');
    setKm(line?.mileageKm != null ? String(line.mileageKm) : '');
    setNotes(line?.notes ?? '');
    setFiles([]);
    setTouched(false);
    setError(null);
  }, [open, line, maxDate]);

  // The DCR of the chosen day is linked automatically.
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
        if (ac.signal.aborted) return;
        const d = r.data?.items.find((x) => x.date === date);
        setDcr({ date, id: d?.id ?? null, status: d?.status });
      })(),
    );
    return () => ac.abort();
  }, [open, date]);

  const dateProblem =
    !date || date > maxDate || (minDate && date < minDate)
      ? month
        ? 'Pick a day in this month, up to today.'
        : 'Pick a day up to today.'
      : null;
  const draft: LineDraft | null = category
    ? {
        date,
        category,
        amount: Math.round(Number(amount) * 100) / 100,
        notes: notes.trim() || null,
        mileageKm: category === 'mileage' ? Number(km) || null : null,
        dcrId: dcr?.date === date ? dcr.id : null,
        tourPlanId: line?.tourPlanId ?? null,
      }
    : null;
  // Inline validation with the shared contract rules.
  const parsed = draft ? ExpenseLineInput.safeParse(draft) : null;
  const fieldError = (f: string) => {
    if (!parsed || parsed.success) return null;
    const i = parsed.error.issues.find((x) => x.path[0] === f);
    if (!i) return null;
    if (f === 'amount') return Number(amount) > 0 ? 'Use at most 2 decimals.' : 'Enter an amount.';
    if (f === 'mileageKm') return 'Enter the kilometres (up to 5000).';
    return i.message;
  };
  const amountErr = fieldError('amount');
  const kmErr = fieldError('mileageKm');
  const needsReceipt =
    category === 'hotel' &&
    files.length === 0 &&
    !line?.attachments.some((a) => a.status === 'confirmed');
  const step0ok = !!category && !dateProblem;
  const step1ok = step0ok && !!parsed?.success;

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      const err = checkFile(f, next.length + (line?.attachments.length ?? 0));
      if (err) {
        setError(err);
        continue;
      }
      next.push(f);
    }
    setFiles(next);
  }

  async function save(submit: boolean) {
    if (!draft || !parsed?.success) return;
    setBusy(submit ? 'submit' : 'draft');
    setError(null);
    try {
      await apiReady();
      let claimId = claim?.id ?? null;
      let before = new Set(claim?.lines.map((l) => l.id) ?? []);
      if (!claimId) {
        const c = await api.POST('/v1/expense-claims', {
          body: { month: date.slice(0, 7) || thisMonth() },
        });
        if (c.error || !c.data) throw new Error(messageFor(toApiError(c)));
        claimId = c.data.id;
        before = new Set(c.data.lines.map((l) => l.id));
      }
      const r = line
        ? await api.PUT('/v1/expense-claims/{id}/lines/{lineId}', {
            params: { path: { id: claimId, lineId: line.id } },
            body: { line: draft, version: line.version },
          })
        : await api.POST('/v1/expense-claims/{id}/lines', {
            params: { path: { id: claimId } },
            body: draft,
          });
      if (r.error || !r.data) throw new Error(messageFor(toApiError(r)));
      const lineId = line?.id ?? r.data.lines.find((l) => !before.has(l.id))?.id;
      if (lineId)
        for (const f of files)
          await uploadReceipt(claimId, lineId, f, () => {}, { viaFetch: MOCKING });
      if (submit) {
        const s = await api.POST('/v1/expense-claims/{id}/submit', {
          params: { path: { id: claimId } },
        });
        if (s.error) {
          onSaved(claimId, false);
          throw new Error(messageFor(toApiError(s)));
        }
      }
      onSaved(claimId, submit);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="gap-5 sm:max-w-lg" data-testid="exp-flow">
        <DialogHeader>
          <DialogTitle>{line ? 'Edit expense' : 'New expense'}</DialogTitle>
          <ol className="flex gap-1.5 pt-2" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li
                key={s}
                aria-current={i === step ? 'step' : undefined}
                className={cn(
                  'h-1 flex-1 rounded-full',
                  i < step ? 'bg-brand-600' : i === step ? 'bg-teal-500' : 'bg-slate-200',
                )}
                title={s}
              />
            ))}
          </ol>
        </DialogHeader>

        {step === 0 && (
          <div className="flex flex-col gap-4" data-testid="exp-flow-step-type">
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Type">
              {EXPENSE_CATEGORIES.map((c) => {
                const I = ICON[c];
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={category === c}
                    onClick={() => {
                      setCategory(c);
                      if (!dateProblem) setStep(1);
                    }}
                    data-testid={`exp-flow-cat-${c}`}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-sm font-medium transition-colors hover:border-teal-400 hover:bg-teal-50 focus-visible:ring-[3px] focus-visible:ring-teal-200 focus-visible:outline-none',
                      category === c && 'border-teal-500 bg-teal-50 text-teal-700',
                    )}
                  >
                    <I className="size-5" aria-hidden />
                    {CATEGORY_LABEL[c]}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-date`}>Date</Label>
              <Input
                id={`${uid}-date`}
                type="date"
                min={minDate}
                max={maxDate}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-invalid={!!dateProblem}
                data-testid="exp-flow-date"
              />
              {dateProblem && <p className="text-xs text-red-700">{dateProblem}</p>}
              {!dateProblem && dcr?.date === date && <DcrHint id={dcr.id} status={dcr.status} />}
            </div>
          </div>
        )}

        {step === 1 && category && (
          <div className="flex flex-col gap-4" data-testid="exp-flow-step-amount">
            <button
              type="button"
              onClick={() => setStep(0)}
              className="flex w-fit items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm"
            >
              {CATEGORY_LABEL[category]} · {dayLabel(date)}
            </button>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-amt`}>Amount</Label>
              <div className="relative">
                <span className="absolute top-1/2 left-3 -translate-y-1/2 text-lg text-muted-foreground">
                  ₹
                </span>
                <Input
                  id={`${uid}-amt`}
                  autoFocus
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                  onBlur={() => setTouched(true)}
                  placeholder="0"
                  aria-invalid={touched && !!amountErr}
                  className="h-12 pl-8 text-lg tabular-nums"
                  data-testid="exp-flow-amount"
                />
              </div>
              {touched && amountErr && <p className="text-xs text-red-700">{amountErr}</p>}
            </div>
            {category === 'mileage' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${uid}-km`}>Kilometres</Label>
                <Input
                  id={`${uid}-km`}
                  inputMode="decimal"
                  value={km}
                  onChange={(e) => setKm(e.target.value.replace(/[^\d.]/g, ''))}
                  aria-invalid={touched && !!kmErr}
                  data-testid="exp-flow-km"
                />
                {touched && kmErr && <p className="text-xs text-red-700">{kmErr}</p>}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label>Receipt{category === 'hotel' ? '' : ' (optional)'}</Label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => camRef.current?.click()}>
                  <Camera aria-hidden /> Photo
                </Button>
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                  <Paperclip aria-hidden /> File
                </Button>
              </div>
              <input
                ref={camRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
                data-testid="exp-flow-file"
              />
              {files.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {files.map((f, i) => (
                    <li
                      key={`${f.name}-${i}`}
                      className="flex items-center gap-1 rounded-full bg-teal-50 px-3 py-1 text-xs text-teal-700"
                    >
                      {f.name}
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {needsReceipt && touched && (
                <p className="text-xs text-amber-800">Hotel needs a receipt to submit.</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-notes`}>Note (optional)</Label>
              <textarea
                id={`${uid}-notes`}
                rows={2}
                maxLength={1000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="rounded-md border bg-background px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
                data-testid="exp-flow-notes"
              />
            </div>
          </div>
        )}

        {step === 2 && draft && (
          <dl
            className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-xl border bg-slate-50 p-4 text-sm"
            data-testid="exp-flow-review"
          >
            <dt className="text-muted-foreground">Type</dt>
            <dd className="font-medium">{CATEGORY_LABEL[draft.category]}</dd>
            <dt className="text-muted-foreground">Date</dt>
            <dd className="font-medium">{dayLabel(draft.date)}</dd>
            {draft.mileageKm != null && (
              <>
                <dt className="text-muted-foreground">Distance</dt>
                <dd className="font-medium">{draft.mileageKm} km</dd>
              </>
            )}
            <dt className="text-muted-foreground">Receipt</dt>
            <dd className="font-medium">
              {files.length + (line?.attachments.length ?? 0) || 'None'}
            </dd>
            <dt className="text-muted-foreground">DCR</dt>
            <dd className="font-medium">{draft.dcrId ? 'Linked' : 'None for this day'}</dd>
            {draft.notes && (
              <>
                <dt className="text-muted-foreground">Note</dt>
                <dd className="break-words">{draft.notes}</dd>
              </>
            )}
            <dt className="self-end text-muted-foreground">Amount</dt>
            <dd className="text-2xl font-semibold text-brand-600 tabular-nums">
              {money(draft.amount)}
            </dd>
          </dl>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-700" data-testid="exp-flow-error">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={!!busy}>
              <ArrowLeft aria-hidden /> Back
            </Button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <Button
              className="bg-brand-600 hover:bg-brand-700"
              disabled={step === 0 ? !step0ok : !step1ok}
              onClick={() => {
                setTouched(true);
                setStep(step + 1);
              }}
              data-testid="exp-flow-next"
            >
              Next <ArrowRight aria-hidden />
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => save(false)}
                data-testid="exp-flow-save"
              >
                {busy === 'draft' && <LoaderCircle className="animate-spin" aria-hidden />}
                Save draft
              </Button>
              <Button
                className="bg-brand-600 hover:bg-brand-700"
                disabled={!!busy || needsReceipt}
                onClick={() => save(true)}
                data-testid="exp-flow-submit"
              >
                {busy === 'submit' && <LoaderCircle className="animate-spin" aria-hidden />}
                Save & submit month
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DcrHint({ id, status }: { id: string | null; status?: string }) {
  if (!id) return <p className="text-xs text-amber-800">No DCR for this day.</p>;
  if (status === 'approved') return <p className="text-xs text-emerald-700">DCR approved ✓</p>;
  return (
    <p className="text-xs text-amber-800">
      DCR {status ?? 'pending'} — approval needs it approved.
    </p>
  );
}
