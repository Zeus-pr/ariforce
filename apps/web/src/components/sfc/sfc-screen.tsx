'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ariforce/ui/components/tabs';
import { cn } from '@ariforce/ui/lib/utils';
import {
  DEFAULT_RATE,
  asFailure,
  getSettings,
  saveRate,
  listPeople,
  type SfcEmployee,
} from '@/lib/sfc/adapter';
import { roleLabel } from '@/lib/roles';
import { useRole } from '@/components/shell/role-context';
import { can } from '@/lib/expenses/model';
import { SfcTable } from './sfc-table';

const step = 'flex flex-col gap-3 rounded-lg border p-4';
const stepTitle = 'text-sm font-semibold';

export function SfcScreen() {
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [rateVersion, setRateVersion] = useState<number | null>(null);
  const { role } = useRole();
  const mayRate = can(role, 'settings:write');
  const [people, setPeople] = useState<SfcEmployee[] | null>(null);
  const [personQ, setPersonQ] = useState('');
  const [emp, setEmp] = useState<SfcEmployee | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);

  useEffect(() => {
    void getSettings().then((s) => {
      setRate(s.ratePerKm);
      setRateVersion(s.version);
    });
    listPeople()
      .then(setPeople)
      .catch((e) => {
        setPeople([]);
        setErr(asFailure(e).message);
      });
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** Run `go` now, or after the user agrees to drop unsaved rows. */
  const guard = (go: () => void) => (dirty ? setPending(() => go) : go());

  const pickPerson = (e: SfcEmployee) => {
    if (!e.canEdit) return;
    guard(() => {
      if (!e.hqId) {
        setErr('This person has no headquarters, so a chart cannot be saved.');
        return;
      }
      setDirty(false);
      setEmp(e);
      setErr(null);
    });
  };
  const found = useMemo(() => {
    const q = personQ.trim().toLowerCase();
    return (people ?? []).filter((p) =>
      `${p.name} ${p.employeeCode ?? ''}`.toLowerCase().includes(q),
    );
  }, [people, personQ]);
  const onDirty = useCallback((d: boolean) => setDirty(d), []);

  return (
    <div className="flex flex-col gap-4">
      {mayRate && rateVersion !== null && (
        <RateControl
          rate={rate}
          version={rateVersion}
          onSaved={(r, v) => {
            setRate(r);
            setRateVersion(v);
          }}
        />
      )}
      {err && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          data-testid="sfc-load-error"
        >
          {err}
        </p>
      )}
      <section className={step} data-testid="sfc-search">
        <h2 className={stepTitle}>Person</h2>
        <Input
          aria-label="Search people"
          placeholder="Search by name or employee code"
          value={personQ}
          onChange={(e) => setPersonQ(e.target.value)}
          data-testid="sfc-person-search"
          autoComplete="off"
        />
        <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
          {people === null ? (
            <li className="p-3 text-sm text-muted-foreground">Loading…</li>
          ) : found.length === 0 ? (
            <li className="p-3 text-sm text-muted-foreground" data-testid="sfc-person-none">
              No one matches.
            </li>
          ) : (
            found.map((e) =>
              e.canEdit ? (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => pickPerson(e)}
                    aria-pressed={emp?.id === e.id}
                    className={cn(
                      'flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60',
                      emp?.id === e.id && 'bg-primary/10 font-medium',
                    )}
                    data-testid="sfc-person"
                  >
                    <span>{e.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {[e.employeeCode, roleLabel(e.role)].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ) : (
                <li
                  key={e.id}
                  className="bg-muted/40 px-3 py-2 text-muted-foreground"
                  data-testid="sfc-person-locked"
                >
                  <div className="flex justify-between gap-2 text-sm">
                    <span>{e.name}</span>
                    <span className="text-xs">
                      {[e.employeeCode, roleLabel(e.role)].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <p className="text-xs">You can’t edit this person’s SFC.</p>
                </li>
              ),
            )
          )}
        </ul>
      </section>

      {emp && emp.hqId && (
        <section className="flex flex-col gap-3" data-testid="sfc-step-table">
          <h2 className="text-base font-semibold" data-testid="sfc-who">
            {emp.name}
          </h2>
          <Tabs defaultValue="tada">
            <TabsList>
              <TabsTrigger value="tada" data-testid="sfc-tab-tada">
                TA/DA
              </TabsTrigger>
            </TabsList>
            <TabsContent value="tada" className="mt-3">
              <SfcTable
                key={emp.id}
                userId={emp.id}
                hqId={emp.hqId}
                name={emp.name}
                rate={rate}
                editable={emp.canEdit}
                onDirty={onDirty}
              />
            </TabsContent>
          </Tabs>
        </section>
      )}

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent data-testid="sfc-discard">
          <DialogHeader>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription>
              Your changes to {emp?.name ?? 'this SFC'} are not saved. If you go on, they are lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPending(null)}
              data-testid="sfc-discard-cancel"
            >
              Keep editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const go = pending;
                setPending(null);
                go?.();
              }}
              data-testid="sfc-discard-ok"
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Company-wide TA rate per km (settings:write: Director, System Admin). */
function RateControl({
  rate,
  version,
  onSaved,
}: {
  rate: number;
  version: number;
  onSaved: (rate: number, version: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const t = value.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(t) || Number(t) <= 0 || Number(t) > 1000) {
      setMsg('Enter a rate above 0 and up to 1,000, with up to 2 decimals.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const s = await saveRate(Number(t), version);
      onSaved(s.ratePerKm, s.version ?? version + 1);
      setOpen(false);
    } catch (e) {
      const f = asFailure(e);
      if (f.kind === 'conflict') {
        const s = await getSettings();
        if (s.version !== null) onSaved(s.ratePerKm, s.version);
        setMsg('Someone else changed the rate. The latest rate is shown; try again.');
      } else setMsg(f.kind === 'forbidden' ? 'You can’t change the rate.' : f.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="sfc-rate-control">
      <span>
        Company rate: <span className="font-medium tabular-nums">₹{rate.toFixed(2)}</span> per km
      </span>
      {!open ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setValue(rate.toFixed(2));
            setMsg(null);
            setOpen(true);
          }}
          data-testid="sfc-rate-edit"
        >
          Change
        </Button>
      ) : (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            aria-label="Rate per km"
            inputMode="decimal"
            className="h-8 w-24"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))}
            data-testid="sfc-rate-input"
          />
          <Button type="submit" size="sm" disabled={busy} data-testid="sfc-rate-save">
            Save rate
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </form>
      )}
      {msg && (
        <p className="w-full text-destructive" role="alert" data-testid="sfc-rate-error">
          {msg}
        </p>
      )}
    </div>
  );
}
