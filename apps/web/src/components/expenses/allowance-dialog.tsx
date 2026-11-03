'use client';

import { LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AllowanceDraftResult, AllowancePlace } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import { api, toApiError } from '@/lib/api';
import { messageFor, money } from '@/lib/expenses/model';

export const ISSUE_LABEL: Record<string, string> = {
  no_rate: 'No allowance rate set for this day',
  place_required: 'Choose the place you travelled to',
  manual_line_exists: 'You already added an allowance or mileage line for this day',
  dcr_not_submitted: 'DCR not submitted yet',
};
export const BAND_LABEL: Record<string, string> = {
  hq: 'HQ',
  ex_hq: 'Ex-HQ',
  outstation: 'Outstation',
};
const day = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

export function allowanceError(code: string | undefined, message?: string): string {
  if (code === 'EXPENSE_NOT_EDITABLE') return 'This claim can no longer be changed.';
  if (code === 'PLACE_NOT_USABLE')
    return 'One of the chosen places cannot be used. Pick another place.';
  if (code === 'FORBIDDEN') return 'Only the owner of the claim can add allowances.';
  return messageFor({ code: code ?? '', message: message ?? '' });
}

export function AllowanceDialog({
  claimId,
  open,
  onClose,
  onDone,
}: {
  claimId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [places, setPlaces] = useState<AllowancePlace[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<AllowanceDraftResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (dryRun: boolean, pl: Record<string, string>) => {
      setBusy(true);
      setError(null);
      const r = await api.POST('/v1/expense-claims/{id}/allowances', {
        params: { path: { id: claimId } },
        body: { dryRun, places: pl },
      });
      setBusy(false);
      if (!r.data) {
        const e = toApiError(r);
        setError(allowanceError(e.code, e.message));
        return null;
      }
      return r.data;
    },
    [claimId],
  );

  useEffect(() => {
    if (!open) return;
    setChosen({});
    setPreview(null);
    void api
      .GET('/v1/allowance-places', { params: { query: {} } })
      .then((r) => setPlaces(r.data?.items.filter((p) => p.active) ?? []));
    void run(true, {}).then((d) => d && setPreview(d));
  }, [open, run]);

  const pick = async (date: string, placeId: string) => {
    const next = { ...chosen, [date]: placeId };
    setChosen(next);
    const d = await run(true, next);
    if (d) setPreview(d);
  };

  const confirm = async () => {
    const d = await run(false, chosen);
    if (d) {
      onDone();
      onClose();
    }
  };

  const days = preview?.days.filter((d) => d.band || d.issues.length) ?? [];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
        data-testid="alw-dialog"
      >
        <DialogHeader>
          <DialogTitle>Add allowances</DialogTitle>
          <DialogDescription>
            Daily allowance (DA) and travel allowance (TA) from your submitted DCRs and the company
            rate card. Check the preview, then confirm.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="alw-error">
            {error}
          </p>
        )}
        {!preview && !error && (
          <p className="text-sm text-muted-foreground">Working out your allowances…</p>
        )}
        {preview && days.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="alw-empty">
            No DCR days this month qualify for allowances.
          </p>
        )}
        {days.length > 0 && (
          <ul className="divide-y rounded-lg border text-sm" data-testid="alw-days">
            {days.map((d) => {
              const needsPlace = d.band === 'ex_hq' || d.band === 'outstation';
              const opts = places.filter((p) => p.band === d.band);
              return (
                <li
                  key={d.date}
                  className="flex flex-col gap-1.5 px-3 py-2"
                  data-testid="alw-day"
                  data-issues={d.issues.join(' ')}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {day(d.date)}{' '}
                      <span className="font-normal text-muted-foreground">
                        · {d.band ? BAND_LABEL[d.band] : 'No allowance'}
                      </span>
                    </span>
                    <span className="tabular-nums">
                      DA {money(d.da)} · TA {money(d.ta)}
                      {d.km != null && ` · ${d.km} km`}
                    </span>
                  </div>
                  {needsPlace && (
                    <Select
                      value={chosen[d.date] ?? d.placeId ?? ''}
                      onValueChange={(v) => void pick(d.date, v)}
                    >
                      <SelectTrigger
                        className="w-full sm:w-64"
                        aria-label={`Place on ${day(d.date)}`}
                        data-testid="alw-place"
                      >
                        <SelectValue placeholder="Choose place" />
                      </SelectTrigger>
                      <SelectContent>
                        {opts.length === 0 && (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            No places set up for this band. Ask your administrator.
                          </div>
                        )}
                        {opts.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} ({p.oneWayKm} km one way)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {d.issues.map((i) => (
                    <span
                      key={i}
                      className="w-fit rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900"
                      data-testid="alw-issue"
                    >
                      {ISSUE_LABEL[i] ?? i}
                    </span>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
        {preview && (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="alw-totals">
            {[
              ['DA', money(preview.totals.da)],
              ['TA', money(preview.totals.ta)],
              ['Distance', `${preview.totals.km} km`],
              ['Lines', String(preview.totals.lines)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border p-2">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !preview || preview.totals.lines === 0}
            onClick={() => void confirm()}
            data-testid="alw-confirm"
          >
            {busy && <LoaderCircle className="animate-spin" aria-hidden />}
            Add {preview?.totals.lines ?? 0} line{preview?.totals.lines === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
