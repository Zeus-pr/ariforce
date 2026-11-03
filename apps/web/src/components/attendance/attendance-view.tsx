'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { toast } from '@ariforce/ui/components/sonner';
import type {
  AttendanceDay,
  CheckIn,
  CheckInCreate,
  ConsentState,
  Doctor,
} from '@ariforce/contracts';
import { Badge } from '@ariforce/ui/components/badge';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import { api, apiReady, toApiError } from '@/lib/api';
import { isFieldRole } from '@/lib/roles';
import { useRole } from '@/components/shell/role-context';
import { CheckInMap, MapLegend } from './check-in-map';
import { dateLabel, kindLabel, timeIST, todayIST } from './format';
import { cachedGet } from '@/lib/query';
import { allPages } from '@/lib/paging';

type Fix = {
  location: { lat: number; lng: number };
  accuracyM: number;
  capturedAt: string;
  isMock: boolean;
  demo: boolean;
};

function getFix(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator))
      return reject(new Error('This browser has no location access.'));
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          location: { lat: p.coords.latitude, lng: p.coords.longitude },
          accuracyM: Math.min(10000, Math.round(p.coords.accuracy)),
          capturedAt: new Date(p.timestamp).toISOString(),
          isMock: false,
          demo: false,
        }),
      (e) => reject(new Error(e.message || 'Location unavailable.')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

const STATUS_TONE: Record<AttendanceDay['status'], string> = {
  present: 'bg-success/10 text-success',
  incomplete: 'bg-warning/10 text-warning',
  absent: 'bg-destructive/10 text-destructive',
  leave: 'bg-muted text-muted-foreground',
  holiday: 'bg-muted text-muted-foreground',
};

const noop = () => () => {};

/** The page is prerendered, so "today" must come from the browser, never the build. */
export function AttendanceView() {
  const today = useSyncExternalStore(noop, todayIST, () => null);
  if (!today) return <div className="h-[560px]" aria-busy="true" />;
  return <AttendanceDayView today={today} />;
}

function AttendanceDayView({ today }: { today: string }) {
  const { role } = useRole();
  const field = role ? isFieldRole(role) : false;
  const [date, setDate] = useState(today);
  const [checkIns, setCheckIns] = useState<CheckIn[] | null>(null);
  const [days, setDays] = useState<AttendanceDay[] | null>(null);
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [doctorNames, setDoctorNames] = useState<Map<string, string>>(new Map());
  const [doctorNamesError, setDoctorNamesError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    await apiReady();
    const q = { from: date, to: date, limit: 200 };
    // Page through: a big team can have more than 200 check-ins in a day.
    const [c, a] = await Promise.all([
      allPages((cursor) =>
        api.GET('/v1/check-ins', { params: { query: { ...q, ...(cursor ? { cursor } : {}) } } }),
      ),
      allPages((cursor) =>
        api.GET('/v1/attendance', { params: { query: { ...q, ...(cursor ? { cursor } : {}) } } }),
      ),
    ]);
    if (c.error || a.error) return setError(toApiError(c.error ? c : a).message);
    setError(null);
    setCheckIns(c.data?.items ?? []);
    setDays(a.data?.items ?? []);
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!checkIns?.length) {
      setDoctorNames(new Map());
      setDoctorNamesError(null);
      return;
    }
    let live = true;
    void (async () => {
      await apiReady();
      const ids = [
        ...new Set(
          checkIns.flatMap((c) => (c.outletId && c.outletKind === 'doctor' ? [c.outletId] : [])),
        ),
      ];
      const results = await Promise.all(
        Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) =>
          cachedGet(['doctors', 'ids', ids.slice(i * 100, (i + 1) * 100).join(',')], () =>
            api.GET('/v1/doctors', {
              params: { query: { ids: ids.slice(i * 100, (i + 1) * 100).join(','), limit: 100 } },
            }),
          ),
        ),
      );
      if (!live) return;
      const names = new Map<string, string>();
      const failed = results.find((result) => result.error);
      for (const result of results) {
        if (result.data) result.data.items.forEach((doctor) => names.set(doctor.id, doctor.name));
      }
      setDoctorNames(names);
      setDoctorNamesError(failed ? toApiError(failed).message : null);
    })().catch(() => {
      if (live) {
        setDoctorNames(new Map());
        setDoctorNamesError('Could not load doctor names for check-ins.');
      }
    });
    return () => {
      live = false;
    };
  }, [checkIns]);

  useEffect(() => {
    if (!field) return;
    void apiReady()
      .then(() => api.GET('/v1/me/consent'))
      .then((r) => {
        if (r.data) setConsent(r.data);
      })
      .catch(() => {});
  }, [field]);

  const placeOf = useCallback(
    (c: CheckIn) =>
      c.outletId ? (doctorNames.get(c.outletId) ?? `${c.outletKind} visit`) : kindLabel(c.kind),
    [doctorNames],
  );

  const points = checkIns ?? [];
  const sorted = useMemo(
    () => [...points].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)),
    [points],
  );

  return (
    <div className="flex flex-col gap-6">
      {field && date === today && <TodayPanel consent={consent} checkIns={points} onDone={load} />}

      <section className="flex flex-col gap-3" aria-labelledby="att-day">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="att-day" className="text-base font-semibold">
              {dateLabel(date)}
            </h2>
            <p className="text-sm text-muted-foreground">
              GPS is captured only at punch in, each visit and punch out. No tracking in between.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="att-date">Date</Label>
            <Input
              id="att-date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="w-44"
              data-testid="att-date"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <CheckInMap
          points={points}
          placeOf={placeOf}
          selectedId={selected}
          onSelect={setSelected}
          className="h-[320px] sm:h-[420px]"
          label={`Check-ins on ${dateLabel(date)}`}
        />
        <MapLegend />

        <div className="overflow-x-auto rounded-lg border" data-testid="att-checkins">
          <table className="w-full text-sm">
            <caption className="sr-only">Check-ins</caption>
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Place</th>
                <th className="px-3 py-2 text-right font-medium">Accuracy</th>
                <th className="px-3 py-2 font-medium">Fence</th>
              </tr>
            </thead>
            <tbody>
              {checkIns === null ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    No check-ins on this day.
                  </td>
                </tr>
              ) : (
                sorted.map((c) => (
                  <tr
                    key={c.id}
                    data-testid="att-row"
                    aria-selected={selected === c.id}
                    onClick={() => setSelected(c.id)}
                    className="cursor-pointer border-t transition-colors hover:bg-muted/40 aria-selected:bg-accent/10"
                  >
                    <td className="px-3 py-2 tabular-nums">{timeIST(c.capturedAt)}</td>
                    <td className="px-3 py-2">{kindLabel(c.kind)}</td>
                    <td className="px-3 py-2">{c.outletId ? placeOf(c) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      ±{Math.round(c.accuracyM)} m
                    </td>
                    <td className="px-3 py-2">
                      {c.inFence === null ? (
                        <span className="text-muted-foreground">n/a</span>
                      ) : c.inFence ? (
                        'Inside'
                      ) : (
                        <Badge variant="outline" className="border-warning text-warning">
                          Outside{c.distanceM !== null ? ` · ${Math.round(c.distanceM)} m` : ''}
                        </Badge>
                      )}
                      {c.isMock && (
                        <Badge variant="destructive" className="ml-2">
                          Mock GPS
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {doctorNamesError && (
          <p className="text-sm text-destructive" role="alert">
            {doctorNamesError}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="att-days">
        <h2 id="att-days" className="text-base font-semibold">
          Day summary
        </h2>
        <div className="overflow-x-auto rounded-lg border" data-testid="att-days">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">In</th>
                <th className="px-3 py-2 font-medium">Out</th>
                <th className="px-3 py-2 text-right font-medium">Visits</th>
              </tr>
            </thead>
            <tbody>
              {(days ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    {days ? 'Nobody has punched in on this day.' : 'Loading…'}
                  </td>
                </tr>
              ) : (
                days!.map((d) => (
                  <tr key={`${d.userId}${d.date}`} className="border-t" data-testid="att-day-row">
                    <td className="px-3 py-2 font-medium">{d.userName}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium capitalize ${STATUS_TONE[d.status]}`}
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {d.punchIn ? timeIST(d.punchIn.capturedAt) : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {d.punchOut ? timeIST(d.punchOut.capturedAt) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.visits}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function TodayPanel({
  consent,
  checkIns,
  onDone,
}: {
  consent: ConsentState | null;
  checkIns: CheckIn[];
  onDone: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<CheckIn['kind'] | null>(null);
  const [doctorId, setDoctorId] = useState<string>('');
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [doctorsError, setDoctorsError] = useState<string | null>(null);
  const hasIn = checkIns.some((c) => c.kind === 'punch_in');
  const hasOut = checkIns.some((c) => c.kind === 'punch_out');
  const blocked = consent ? !consent.canCheckIn : false;

  async function loadDoctors() {
    if (doctors.length || doctorsLoading) return;
    setDoctorsLoading(true);
    setDoctorsError(null);
    try {
      await apiReady();
      const r = await cachedGet(['doctors', 'first-page'], () =>
        api.GET('/v1/doctors', { params: { query: { limit: 100, sort: 'name' } } }),
      );
      if (!r.data) throw new Error(toApiError(r).message || 'Could not load doctors.');
      setDoctors(r.data.items);
    } catch (cause) {
      setDoctorsError(cause instanceof Error ? cause.message : 'Could not load doctors.');
    } finally {
      setDoctorsLoading(false);
    }
  }

  async function submit(kind: CheckIn['kind']) {
    setBusy(kind);
    try {
      const fix = await getFix();
      const body: CheckInCreate = {
        clientId: crypto.randomUUID(),
        kind,
        location: fix.location,
        accuracyM: fix.accuracyM,
        capturedAt: fix.capturedAt,
        isMock: fix.isMock,
        ...(kind === 'visit' ? { outletKind: 'doctor' as const, outletId: doctorId } : {}),
      };
      const r = await api.POST('/v1/check-ins', { body });
      if (r.error) throw new Error(toApiError(r).message);
      toast.success(`${kindLabel(kind)} recorded${fix.demo ? ' (demo location)' : ''}`);
      if (kind === 'visit') setDoctorId('');
      await onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const state = !hasIn ? 'Not punched in' : hasOut ? 'Day closed' : 'On the field';
  return (
    <section
      aria-labelledby="att-today"
      className="af-enter rounded-lg border p-4"
      data-testid="att-today"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="att-today" className="text-base font-semibold">
          Today
        </h2>
        <p className="text-sm text-muted-foreground" data-testid="att-state">
          {state}
        </p>
      </div>
      {blocked ? (
        <p className="mt-3 text-sm">
          Location consent is needed before you can check in.{' '}
          <a
            className="underline underline-offset-4"
            href={consent!.noticeUrl}
            target="_blank"
            rel="noreferrer"
          >
            Read the notice
          </a>
          .
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          {!hasIn && (
            <Button onClick={() => submit('punch_in')} disabled={!!busy} data-testid="punch-in">
              {busy === 'punch_in' ? 'Getting location…' : 'Punch in'}
            </Button>
          )}
          {hasIn && !hasOut && (
            <>
              <div className="flex flex-col gap-1.5 sm:w-72">
                <Label htmlFor="att-doctor">Visit</Label>
                <Select
                  value={doctorId}
                  onValueChange={setDoctorId}
                  onOpenChange={(open) => {
                    if (open) void loadDoctors();
                  }}
                >
                  <SelectTrigger id="att-doctor" data-testid="visit-doctor" className="w-full">
                    <SelectValue placeholder="Choose a doctor" />
                  </SelectTrigger>
                  <SelectContent>
                    {doctors.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {doctorsLoading && (
                  <p className="text-xs text-muted-foreground">Loading doctors…</p>
                )}
                {doctorsError && (
                  <p className="text-xs text-destructive" role="alert">
                    {doctorsError}
                  </p>
                )}
              </div>
              <Button
                onClick={() => submit('visit')}
                disabled={!doctorId || !!busy}
                data-testid="check-in-visit"
              >
                {busy === 'visit' ? 'Getting location…' : 'Check in'}
              </Button>
              <Button
                variant="outline"
                onClick={() => submit('punch_out')}
                disabled={!!busy}
                data-testid="punch-out"
              >
                {busy === 'punch_out' ? 'Getting location…' : 'Punch out'}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
