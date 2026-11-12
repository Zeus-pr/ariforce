'use client';

import { ExternalLink, Loader2, MapPin, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { OutletLocation } from '@ariforce/contracts';

type OutletKind = OutletLocation['outletKind'];
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@ariforce/ui/components/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import { Label } from '@ariforce/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import { toast } from '@ariforce/ui/components/sonner';
import { useRole } from '@/components/shell/role-context';
import { api, apiReady, toApiError } from '@/lib/api';
import { canManageOutletLocks } from '@/lib/permissions';

const LABELS: Record<OutletKind, { value: string; label: string }[]> = {
  doctor: [
    { value: 'clinic', label: 'Clinic' },
    { value: 'hospital', label: 'Hospital' },
    { value: 'chamber', label: 'Chamber' },
    { value: 'residence', label: 'Residence' },
    { value: 'nursing_home', label: 'Nursing home' },
    { value: 'other', label: 'Other' },
  ],
  chemist: [
    { value: 'retail_shop', label: 'Retail shop' },
    { value: 'distributor_counter', label: 'Distributor counter' },
    { value: 'other', label: 'Other' },
  ],
  stockist: [
    { value: 'godown', label: 'Godown' },
    { value: 'depot', label: 'Depot' },
    { value: 'office', label: 'Office' },
    { value: 'other', label: 'Other' },
  ],
};

function labelText(kind: OutletKind, value: string) {
  return LABELS[kind].find((x) => x.value === value)?.label ?? value;
}

function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function fmtWhen(iso: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

/**
 * Active GPS locks for one doctor / chemist / stockist.
 * Managers (ABM+) can change the label or deactivate a wrong first lock so the next mobile
 * Check in locks again.
 */
export function OutletLocksCard({
  outletKind,
  outletId,
  className,
  compact,
}: {
  outletKind: OutletKind;
  outletId: string;
  className?: string;
  /** Tighter layout inside a sheet. */
  compact?: boolean;
}) {
  const { role } = useRole();
  const canManage = canManageOutletLocks(role);
  const [items, setItems] = useState<OutletLocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drop, setDrop] = useState<OutletLocation | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [capBusy, setCapBusy] = useState(false);

  const loadCap = useCallback(async () => {
    const doctor = await api.GET('/v1/doctors/{id}', {
      params: { path: { id: outletId } },
    });
    const n = doctor.data?.maxActiveLocks;
    setCap(typeof n === 'number' ? n : 1);
  }, [outletId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      await apiReady();
      const r = await api.GET('/v1/outlets/{kind}/{id}/locations', {
        params: { path: { kind: outletKind, id: outletId } },
      });
      // Prefer HTTP ok + items even when openapi-fetch leaves a parse `error`.
      if (r.response?.ok) {
        setItems(r.data?.items ?? []);
        if (outletKind === 'doctor') await loadCap();
        return;
      }
      // 403 used to surface as NETWORK → false “No lock yet” (sysadmin lacked field:read).
      if (r.response?.status === 403) {
        setItems([]);
        setError('You do not have permission to view locked locations.');
        return;
      }
      if (r.response?.status === 404) {
        setItems([]);
        setError(null);
        return;
      }
      if (r.error) throw toApiError(r);
      setItems(r.data?.items ?? []);
      if (outletKind === 'doctor') await loadCap();
    } catch (e) {
      const apiErr = e instanceof Error ? { code: 'NETWORK', message: e.message } : toApiError(e);
      setItems([]);
      setError(apiErr.message || 'Could not load locks.');
    }
  }, [loadCap, outletKind, outletId]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  async function patch(
    loc: OutletLocation,
    body: { label?: OutletLocation['label']; active?: boolean },
  ) {
    setBusyId(loc.id);
    try {
      await apiReady();
      const r = await api.PATCH('/v1/outlet-locations/{id}', {
        params: { path: { id: loc.id } },
        body: { version: loc.version, ...body },
      });
      if (r.error) throw toApiError(r);
      toast.success(body.active === false ? 'Location deactivated' : 'Location updated');
      setDrop(null);
      await load();
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setBusyId(null);
    }
  }

  async function saveCap(next: number) {
    setCapBusy(true);
    try {
      await apiReady();
      const r = await api.PATCH('/v1/outlets/{kind}/{id}/lock-cap', {
        params: { path: { kind: 'doctor', id: outletId } },
        body: { maxActiveLocks: next },
      });
      if (r.error) throw toApiError(r);
      setCap(r.data?.maxActiveLocks ?? next);
      toast.success(
        next === 1
          ? 'This doctor can have 1 active pin'
          : `This doctor can have ${next} active pins`,
      );
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setCapBusy(false);
    }
  }

  const body =
    items === null ? (
      <div className="h-16 animate-pulse rounded-md bg-muted/40" aria-busy="true" />
    ) : error ? (
      <p className="text-sm text-destructive" data-testid="outlet-locks-error">
        {error}
      </p>
    ) : items.length === 0 ? (
      <p className="text-sm text-muted-foreground" data-testid="outlet-locks-empty">
        No lock yet. The first Check in on mobile will set the GPS pin
        {outletKind === 'doctor' ? ' (clinic by default)' : ''}.
      </p>
    ) : (
      <ul className="divide-y" data-testid="outlet-locks-list">
        {items.map((loc) => {
          const busy = busyId === loc.id;
          return (
            <li
              key={loc.id}
              className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
              data-testid="outlet-lock"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{labelText(outletKind, loc.label)}</Badge>
                  {loc.accuracyM != null && (
                    <span className="text-xs text-muted-foreground">
                      ±{Math.round(loc.accuracyM)} m
                    </span>
                  )}
                </div>
                <p className="flex items-start gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    {loc.location.lat.toFixed(5)}, {loc.location.lng.toFixed(5)}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Locked {fmtWhen(loc.lockedAt)}
                  {loc.lockedByName ? ` · ${loc.lockedByName}` : ''}
                </p>
                <a
                  href={mapsUrl(loc.location.lat, loc.location.lng)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Open map <ExternalLink className="size-3" />
                </a>
              </div>
              {canManage ? (
                <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                  <div className="grid w-full gap-1.5 sm:w-44">
                    <Label htmlFor={`lock-label-${loc.id}`} className="sr-only">
                      Label
                    </Label>
                    <Select
                      value={loc.label}
                      disabled={busy}
                      onValueChange={(v) =>
                        void patch(loc, { label: v as OutletLocation['label'] })
                      }
                    >
                      <SelectTrigger id={`lock-label-${loc.id}`} data-testid="outlet-lock-label">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LABELS[outletKind].map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    disabled={busy}
                    data-testid="outlet-lock-deactivate"
                    onClick={() => setDrop(loc)}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    Deactivate
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    );

  return (
    <>
      <Card
        className={
          compact
            ? `gap-0 border-0 py-0 shadow-none ${className ?? ''}`
            : `gap-0 py-0 shadow-xs ${className ?? ''}`
        }
        data-testid="outlet-locks"
      >
        <CardHeader className={compact ? 'px-0 pb-3 pt-0' : 'border-b px-4 py-4'}>
          <CardTitle className="text-base">Locked locations</CardTitle>
          <CardDescription>
            GPS pins for check-in and Presentation.
            {outletKind === 'doctor' && cap != null
              ? cap === 1
                ? ' This doctor can have 1 active pin.'
                : ` This doctor can have ${cap} active pins.`
              : ''}
            {canManage
              ? ' Deactivate a wrong pin so the next Check in on mobile locks again.'
              : ' Ask your ABM or admin to fix a wrong pin.'}
          </CardDescription>
          {outletKind === 'doctor' && canManage && cap != null ? (
            <div className="mt-3 flex items-center gap-3">
              <Label htmlFor="doctor-lock-cap">Active pins allowed</Label>
              <Select
                value={String(cap)}
                disabled={capBusy}
                onValueChange={(value) => void saveCap(Number(value))}
              >
                <SelectTrigger id="doctor-lock-cap" className="w-24" data-testid="doctor-lock-cap">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </CardHeader>
        <div className={compact ? 'px-0 pb-0' : 'px-4 py-3'}>{body}</div>
      </Card>

      <Dialog open={!!drop} onOpenChange={(o) => !o && setDrop(null)}>
        <DialogContent data-testid="outlet-lock-deactivate-dialog">
          <DialogHeader>
            <DialogTitle>Deactivate this lock?</DialogTitle>
            <DialogDescription>
              The pin is removed from check-in. The next Check in on mobile will lock a new location
              at the rep&apos;s GPS. History keeps the old coordinates.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={!!busyId}
              onClick={() => drop && void patch(drop, { active: false })}
            >
              {busyId ? <Loader2 className="animate-spin" /> : null}
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
