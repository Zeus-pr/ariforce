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
  getRate,
  listEmployees,
  listHqs,
  type SfcEmployee,
  type SfcHq,
} from '@/lib/sfc/adapter';
import { roleLabel } from '@/lib/roles';
import { SfcTable } from './sfc-table';

const step = 'flex flex-col gap-3 rounded-lg border p-4';
const stepTitle = 'text-sm font-semibold';

export function SfcScreen() {
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [hqs, setHqs] = useState<SfcHq[] | null>(null);
  const [hqQ, setHqQ] = useState('');
  const [hq, setHq] = useState<SfcHq | null>(null);
  const [emps, setEmps] = useState<SfcEmployee[] | null>(null);
  const [emp, setEmp] = useState<SfcEmployee | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);

  useEffect(() => {
    void getRate().then(setRate);
    listHqs()
      .then(setHqs)
      .catch((e) => {
        setHqs([]);
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

  const pickHq = (h: SfcHq) =>
    guard(() => {
      setHq(h);
      setEmp(null);
      setEmps(null);
      setDirty(false);
      listEmployees(h.id)
        .then(setEmps)
        .catch((e) => {
          setEmps([]);
          setErr(asFailure(e).message);
        });
    });
  const pickEmp = (e: SfcEmployee) =>
    guard(() => {
      setDirty(false);
      setEmp(e);
    });

  const groups = useMemo(() => {
    const q = hqQ.trim().toLowerCase();
    const m = new Map<string, { area: string; items: SfcHq[] }>();
    for (const h of hqs ?? []) {
      if (q && !`${h.name} ${h.code} ${h.areaName}`.toLowerCase().includes(q)) continue;
      const g = m.get(h.areaId) ?? { area: h.areaName, items: [] };
      g.items.push(h);
      m.set(h.areaId, g);
    }
    return [...m.values()];
  }, [hqs, hqQ]);
  const onDirty = useCallback((d: boolean) => setDirty(d), []);

  return (
    <div className="flex flex-col gap-4">
      {err && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          data-testid="sfc-load-error"
        >
          {err}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className={step} data-testid="sfc-step-hq">
          <h2 className={stepTitle}>1. HQ</h2>
          <Input
            aria-label="Search HQs"
            placeholder="Search HQ or area"
            value={hqQ}
            onChange={(e) => setHqQ(e.target.value)}
            data-testid="sfc-hq-search"
            autoComplete="off"
          />
          <div className="max-h-64 overflow-y-auto rounded-md border">
            {hqs === null ? (
              <p className="p-3 text-sm text-muted-foreground">Loading…</p>
            ) : groups.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground" data-testid="sfc-hq-none">
                No HQ matches.
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.area} data-testid="sfc-area">
                  <p
                    className="bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground"
                    data-testid="sfc-area-name"
                  >
                    {g.area}
                  </p>
                  {g.items.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => pickHq(h)}
                      aria-pressed={hq?.id === h.id}
                      className={cn(
                        'flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60',
                        hq?.id === h.id && 'bg-primary/10 font-medium',
                      )}
                      data-testid="sfc-hq-option"
                    >
                      <span>{h.name}</span>
                      <span className="text-xs text-muted-foreground">{h.code}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </section>
        <section className={step} data-testid="sfc-step-emp">
          <h2 className={stepTitle}>2. Employee{hq ? ` at ${hq.name}` : ''}</h2>
          {!hq ? (
            <p className="text-sm text-muted-foreground">Pick an HQ first.</p>
          ) : emps === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : emps.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="sfc-emp-none">
              No one under you at this HQ.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {emps.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => pickEmp(e)}
                    aria-pressed={emp?.id === e.id}
                    className={cn(
                      'flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60',
                      emp?.id === e.id && 'bg-primary/10 font-medium',
                    )}
                    data-testid="sfc-emp"
                  >
                    <span>{e.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {[e.employeeCode, roleLabel(e.role)].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {emp && hq && (
        <section className="flex flex-col gap-3" data-testid="sfc-step-table">
          <h2 className="text-base font-semibold" data-testid="sfc-who">
            3. {emp.name}, {hq.name}
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
                name={emp.name}
                rate={rate}
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
