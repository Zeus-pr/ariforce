'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import { toast } from '@ariforce/ui/components/sonner';
import { cn } from '@ariforce/ui/lib/utils';
import {
  CATEGORIES,
  DA_MAX,
  TRAVEL_MODES,
  asFailure,
  getSheet,
  money,
  saveSheet,
  type SfcFailure,
  type SfcRow,
  type SfcSheet,
} from '@/lib/sfc/adapter';

type Draft = Omit<SfcRow, 'da'> & { km: string; da: string };
const toDraft = (r: SfcRow): Draft => ({
  ...r,
  km: r.distanceKm == null ? '' : String(r.distanceKm),
  da: r.da == null ? '' : String(r.da),
});
/** DA: blank, or 0 to DA_MAX with at most 2 decimals. */
export const parseDa = (s: string): number | null | 'bad' => {
  const t = s.trim().replace(/,/g, '');
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'bad';
  const n = Number(t);
  return n <= DA_MAX ? n : 'bad';
};
const DA_HINT = `DA is an amount from 0 to ${DA_MAX.toLocaleString('en-IN')}, up to 2 decimals, or blank.`;
const parseKm = (s: string): number | null | 'bad' => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : 'bad';
};
const fmt = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const same = (a: Draft[], b: Draft[]) =>
  JSON.stringify(a.map(({ km, distanceKm: _d, ...r }) => ({ ...r, km: km.trim() }))) ===
  JSON.stringify(b.map(({ km, distanceKm: _d, ...r }) => ({ ...r, km: km.trim() })));
let seq = 0;
const newId = () => `new-${Date.now().toString(36)}-${seq++}`;

const cell = 'border-b px-2 py-1.5 align-middle';
const input =
  'h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-[invalid=true]:border-destructive';

export function SfcTable({
  userId,
  hqId,
  name,
  rate,
  editable = true,
  onDirty,
}: {
  userId: string;
  hqId: string;
  name: string;
  rate: number;
  /** canEdit from the employee list; the routes response's canEdit is checked too. */
  editable?: boolean;
  onDirty: (dirty: boolean) => void;
}) {
  const [base, setBase] = useState<SfcSheet | null>(null);
  const [rows, setRows] = useState<Draft[]>([]);
  const [error, setError] = useState<SfcFailure | null>(null);
  const [badRow, setBadRow] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const s = await getSheet(userId);
    setBase(s);
    setRows(s.rows.map(toDraft));
    return s;
  }, [userId]);

  useEffect(() => {
    setBase(null);
    setError(null);
    setBadRow(null);
    load().catch((e) => setError(asFailure(e)));
  }, [load]);

  const orig = useMemo(() => (base ? base.rows.map(toDraft) : []), [base]);
  const dirty = !!base && !same(rows, orig);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const set = (i: number, patch: Partial<Draft>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const out = [...rs];
      [out[i], out[j]] = [out[j]!, out[i]!];
      return out;
    });
  const add = () =>
    setRows((rs) => [
      ...rs,
      {
        id: newId(),
        fromPlace: rs[0]?.fromPlace ?? '',
        toPlace: '',
        distanceKm: null,
        km: '',
        actualFare: false,
        travelMode: 'BIKE',
        category: 'EX',
        da: '',
      },
    ]);

  async function save() {
    if (!base || !base.canEdit || !editable) return;
    setError(null);
    setBadRow(null);
    const out: SfcRow[] = [];
    for (const [i, r] of rows.entries()) {
      const km = parseKm(r.km);
      const da = parseDa(r.da);
      if (da === 'bad') {
        setBadRow(i);
        setError({
          code: 'LOCAL',
          status: 0,
          kind: 'invalid',
          message: `Row ${i + 1}: ${DA_HINT}`,
        });
        return;
      }
      if (
        km === 'bad' ||
        (km === null && !r.actualFare) ||
        !r.fromPlace.trim() ||
        !r.toPlace.trim()
      ) {
        setBadRow(i);
        setError({
          code: 'LOCAL',
          status: 0,
          kind: 'invalid',
          message: `Row ${i + 1}: fill in both places and a distance in km (a number, 0 or more).`,
        });
        return;
      }
      const { km: _k, ...rest } = r;
      out.push({
        ...rest,
        fromPlace: r.fromPlace.trim(),
        toPlace: r.toPlace.trim(),
        da,
        distanceKm: km,
      });
    }
    setSaving(true);
    try {
      await saveSheet(userId, base.etag, base.hqId ?? hqId, out);
      await load();
      toast.success(`SFC saved for ${name}`);
    } catch (e) {
      const f = asFailure(e);
      setError(f);
      if (f.kind === 'conflict') await load().catch(() => {});
      if (f.kind === 'invalid' && f.row != null) setBadRow(f.row);
      if (f.code === 'SFC_ROUTE_NOT_FOUND') await load().catch(() => {});
    } finally {
      setSaving(false);
    }
  }

  if (!base)
    return error ? (
      <p
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        data-testid="sfc-error"
        data-kind={error.kind}
      >
        {error.message}
      </p>
    ) : (
      <div className="h-40 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
    );

  const total = rows.reduce((t, r) => {
    const km = parseKm(r.km);
    return typeof km === 'number' && !r.actualFare ? t + money(km * rate) : t;
  }, 0);

  return (
    <div className="flex flex-col gap-3" data-testid="sfc-table-wrap">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span data-testid="sfc-rate">
          Rate ₹{rate.toFixed(2)} per km. Amounts fill in from the one-way distance.
        </span>
        {dirty && (
          <span
            className="rounded bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning"
            data-testid="sfc-unsaved"
          >
            Unsaved changes
          </span>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className={cn(
            'rounded-md border p-3 text-sm',
            error.kind === 'conflict'
              ? 'border-warning/40 bg-warning/5 text-foreground'
              : 'border-destructive/30 bg-destructive/5 text-destructive',
          )}
          data-testid="sfc-error"
          data-kind={error.kind}
        >
          {error.message}
        </p>
      )}
      {!(base.canEdit && editable) && (
        <p className="text-sm text-muted-foreground" data-testid="sfc-readonly">
          Read only. You can’t edit your own SFC or the SFC of someone at or above your level.
        </p>
      )}
      <fieldset disabled={!(base.canEdit && editable)} className="contents">
        <div className="overflow-x-auto rounded-lg border" data-testid="sfc-scroll">
          <table
            className="w-full min-w-[68rem] border-separate border-spacing-0 text-sm"
            data-testid="sfc-table"
          >
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                {[
                  'SL No',
                  'From place',
                  'To place',
                  'Distance one way (km)',
                  'Distance both way (km)',
                  'Amount one way',
                  'Amount both way',
                  'Travel mode',
                  'Category',
                  'DA',
                ].map((h, i) => (
                  <th
                    key={h}
                    data-testid="sfc-col"
                    className={cn(
                      'border-b bg-muted px-2 py-2 font-medium',
                      i === 0 && 'sticky left-0 z-10 w-14',
                      i >= 3 && i <= 6 && 'text-right',
                    )}
                  >
                    {h}
                  </th>
                ))}
                <th className="border-b bg-muted px-2 py-2">
                  <span className="sr-only">Row actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={11}
                    className="p-6 text-center text-muted-foreground"
                    data-testid="sfc-empty"
                  >
                    No routes yet. Add the first row.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const km = parseKm(r.km);
                const one = typeof km === 'number' ? money(km * rate) : null;
                const bad = badRow === i;
                return (
                  <tr key={r.id} data-testid="sfc-row" className={cn(bad && 'bg-destructive/5')}>
                    <td
                      className={cn(cell, 'sticky left-0 z-10 bg-background font-medium')}
                      data-testid="sfc-sl"
                    >
                      {i + 1}
                    </td>
                    <td className={cell}>
                      <input
                        className={cn(input, 'min-w-32')}
                        aria-label={`From place, row ${i + 1}`}
                        aria-invalid={bad && !r.fromPlace.trim()}
                        value={r.fromPlace}
                        onChange={(e) => set(i, { fromPlace: e.target.value.toUpperCase() })}
                        data-testid="sfc-from"
                      />
                    </td>
                    <td className={cell}>
                      <input
                        className={cn(input, 'min-w-44')}
                        aria-label={`To place, row ${i + 1}`}
                        aria-invalid={bad && !r.toPlace.trim()}
                        value={r.toPlace}
                        onChange={(e) => set(i, { toPlace: e.target.value.toUpperCase() })}
                        data-testid="sfc-to"
                      />
                    </td>
                    <td className={cell}>
                      <input
                        className={cn(input, 'w-24 text-right tabular-nums')}
                        aria-label={`Distance one way in km, row ${i + 1}`}
                        aria-invalid={
                          km === 'bad' ||
                          (bad && km !== null && typeof km === 'number' && km > 2000)
                        }
                        inputMode="decimal"
                        value={r.km}
                        onChange={(e) => set(i, { km: e.target.value })}
                        data-testid="sfc-km"
                      />
                    </td>
                    <td className={cn(cell, 'text-right tabular-nums')} data-testid="sfc-km2">
                      {typeof km === 'number' ? money(km * 2) : ''}
                    </td>
                    <td className={cn(cell, 'text-right tabular-nums')}>
                      <span data-testid="sfc-amt1">
                        {r.actualFare ? 'ACTUAL FARE' : one == null ? '' : fmt(one)}
                      </span>
                      <label className="mt-0.5 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={r.actualFare}
                          onChange={(e) => set(i, { actualFare: e.target.checked })}
                          data-testid="sfc-actual"
                        />
                        Actual fare
                      </label>
                    </td>
                    <td className={cn(cell, 'text-right tabular-nums')} data-testid="sfc-amt2">
                      {r.actualFare ? 'ACTUAL FARE' : one == null ? '' : fmt(money(one * 2))}
                    </td>
                    <td className={cell}>
                      <select
                        className={cn(input, 'min-w-28')}
                        aria-label={`Travel mode, row ${i + 1}`}
                        value={r.travelMode}
                        onChange={(e) => set(i, { travelMode: e.target.value })}
                        data-testid="sfc-mode"
                      >
                        {[...new Set([...TRAVEL_MODES, r.travelMode])].map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={cell}>
                      <select
                        className={cn(input, 'min-w-28')}
                        aria-label={`Category, row ${i + 1}`}
                        value={r.category}
                        onChange={(e) => set(i, { category: e.target.value })}
                        data-testid="sfc-cat"
                      >
                        {[...new Set([...CATEGORIES, r.category])].map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={cell}>
                      <input
                        className={cn(input, 'w-24 text-right tabular-nums')}
                        aria-label={`DA in rupees, row ${i + 1}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={r.da}
                        maxLength={12}
                        aria-invalid={parseDa(r.da) === 'bad'}
                        aria-describedby={
                          parseDa(r.da) === 'bad' ? `sfc-da-err-${r.id}` : undefined
                        }
                        onChange={(e) => set(i, { da: e.target.value.replace(/[^\d.,]/g, '') })}
                        data-testid="sfc-da"
                      />
                      {parseDa(r.da) === 'bad' && (
                        <p
                          id={`sfc-da-err-${r.id}`}
                          className="mt-0.5 max-w-40 text-xs text-destructive"
                          data-testid="sfc-da-error"
                        >
                          0 to {DA_MAX.toLocaleString('en-IN')}, 2 decimals
                        </p>
                      )}
                    </td>
                    <td className={cn(cell, 'whitespace-nowrap')}>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`Move row ${i + 1} up`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        data-testid="sfc-up"
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`Move row ${i + 1} down`}
                        disabled={i === rows.length - 1}
                        onClick={() => move(i, 1)}
                        data-testid="sfc-down"
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8 text-destructive"
                        aria-label={`Delete row ${i + 1}`}
                        onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                        data-testid="sfc-del"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" onClick={add} data-testid="sfc-add">
            <Plus className="size-4" /> Add row
          </Button>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground" data-testid="sfc-total">
              {rows.length} rows, ₹{fmt(total)} one way excluding actual fares
            </span>
            {dirty && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setRows(orig);
                  setError(null);
                  setBadRow(null);
                }}
                data-testid="sfc-reset"
              >
                Undo changes
              </Button>
            )}
            <Button
              type="button"
              onClick={() => void save()}
              disabled={saving || !dirty}
              data-testid="sfc-save"
            >
              {saving ? 'Saving…' : 'Save SFC'}
            </Button>
          </div>
        </div>
      </fieldset>
    </div>
  );
}
