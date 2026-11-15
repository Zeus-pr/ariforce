'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { datesOf, monthLabel, thisMonthIST, weekdayMon } from '@/components/tour-plans/month';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { api, apiReady, toApiError } from '@/lib/api';
import { adminMessage } from '@/lib/admin/messages';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DOW = [1, 2, 3, 4, 5, 6, 0];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Holiday = { id: string; date: string; name: string; version: number };
type Settings = {
  approvalLevels: number;
  backdateDays: number;
  maxFutureDays: number | null;
  weeklyOffDays: number[];
  version: number;
};
type LeaveType = {
  code: string;
  name: string;
  annualQuota: number | null;
  paid: boolean;
  carryForward: boolean;
  carryForwardCap: number | null;
  halfDayAllowed: boolean;
  grantOnly: boolean;
  active: boolean;
  sortOrder: number;
  version: number;
};

export function LeaveMaster() {
  const now = thisMonthIST();
  const [y, setY] = useState(Number(now.slice(0, 4)));
  const [yearText, setYearText] = useState(now.slice(0, 4));
  const [month, setMonth] = useState(now.slice(5, 7));
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(yearNum: number) {
    await apiReady();
    const [h, s, t] = await Promise.all([
      api.GET('/v1/holidays', { params: { query: { year: yearNum } } }),
      api.GET('/v1/leave/settings'),
      api.GET('/v1/leave/types'),
    ]);
    const failed = [h, s, t].find((r) => r.error);
    if (failed?.error) setError(adminMessage(toApiError(failed).code, toApiError(failed).message));
    else setError(null);
    if (!h.error) setHolidays(h.data?.items ?? []);
    if (!s.error) setSettings(s.data ?? null);
    if (!t.error) setTypes(t.data?.items ?? []);
  }
  useEffect(() => {
    void load(y);
  }, [y]);

  const active = `${y}-${month}`;
  const byDate = useMemo(() => new Map(holidays.map((h) => [h.date, h])), [holidays]);
  const dates = datesOf(active);
  const lead = weekdayMon(`${active}-01`);
  const named = holidays.length;

  function fail(e: unknown) {
    const a = toApiError(e);
    setNotice(null);
    setError(adminMessage(a.code, a.message));
  }

  async function saveDay(date: string, name: string) {
    const existing = byDate.get(date);
    const trimmed = name.trim();
    if (!trimmed && !existing) return;
    if (!trimmed && existing) {
      if (!window.confirm(`Remove ${existing.name} on ${date}?`)) return;
      const r = await api.DELETE('/v1/holidays/{id}', { params: { path: { id: existing.id } } });
      if (r.error) return fail(r);
      setNotice(`${existing.name} removed.`);
    } else if (existing) {
      if (trimmed === existing.name) return;
      const r = await api.PATCH('/v1/holidays/{id}', {
        params: { path: { id: existing.id } },
        body: { version: existing.version, name: trimmed },
      });
      if (r.error) return fail(r);
      setNotice(`Saved ${trimmed}.`);
    } else {
      const r = await api.POST('/v1/holidays', { body: { date, name: trimmed } });
      if (r.error) return fail(r);
      setNotice(`Saved ${trimmed}.`);
    }
    setError(null);
    await load(y);
  }

  async function toggleOff(dow: number) {
    if (!settings) return;
    const weeklyOffDays = settings.weeklyOffDays.includes(dow)
      ? settings.weeklyOffDays.filter((d) => d !== dow)
      : [...settings.weeklyOffDays, dow].sort();
    const r = await api.PUT('/v1/leave/settings', { body: { ...settings, weeklyOffDays } });
    if (r.error) return fail(r);
    setSettings(r.data ?? null);
    setError(null);
    setNotice('Weekly off updated. The day stays open for punch-in and reports.');
  }

  async function copyYear() {
    const r = await api.POST('/v1/holidays/copy', { body: { fromYear: y - 1, toYear: y } });
    if (r.error) return fail(r);
    const skipped = r.data?.skipped.length ?? 0;
    setError(null);
    setNotice(
      `Copied ${r.data?.copied ?? 0} holidays.${skipped ? ` ${skipped} dates were already set or could not be copied.` : ''}`,
    );
    await load(y);
  }

  async function carry(fromYear: number) {
    if (
      !window.confirm(
        `Carry unused earned leave from ${fromYear} into ${fromYear + 1}? Running this again does not add the days twice.`,
      )
    )
      return;
    const r = await api.POST('/v1/leave/carry-forward', { body: { fromYear } });
    if (r.error) return fail(r);
    setError(null);
    setNotice(`Carried ${r.data?.totalDays ?? 0} days for ${r.data?.written ?? 0} people.`);
  }

  return (
    <div className="flex flex-col gap-10">
      <nav className="flex gap-2" aria-label="On this page">
        <a
          href="#holidays"
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2"
        >
          Holidays
        </a>
        <a
          href="#leave"
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2"
        >
          Leave
        </a>
      </nav>
      {error && (
        <p
          role="alert"
          className="af-fade rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {notice && <p className="af-fade text-sm text-muted-foreground">{notice}</p>}

      <section
        id="holidays"
        className="flex flex-col gap-4 rounded-xl border-2 border-teal-500 p-4 sm:p-6"
        aria-labelledby="holidays-heading"
      >
        <div>
          <h2 id="holidays-heading" className="text-lg font-semibold">
            Holidays
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Name the company holidays for {y}. They show on the DCR and tour plan calendars.
            Punch-in, DCR, and tour plans stay open.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Year
            <Input
              className="w-28"
              inputMode="numeric"
              value={yearText}
              onChange={(e) => setYearText(e.target.value)}
              onBlur={() => {
                const n = Number(yearText);
                if (n >= 2000 && n <= 2100) setY(n);
                else setYearText(String(y));
              }}
            />
          </label>
          <Button type="button" variant="outline" onClick={() => void copyYear()}>
            Copy {y - 1} into {y}
          </Button>
          <p className="text-sm text-muted-foreground">
            {named === 0 ? `No holidays in ${y} yet.` : `${named} holidays in ${y}.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Month">
          {MONTHS.map((label, i) => {
            const value = String(i + 1).padStart(2, '0');
            const on = month === value;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                className={`rounded-md px-2.5 py-1 text-sm focus-visible:outline focus-visible:outline-2 ${on ? 'bg-foreground text-background' : 'hover:bg-muted'}`}
                onClick={() => setMonth(value)}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div>
          <h3 className="text-base font-medium">{monthLabel(active)}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Click a weekday to mark the weekly off. Type a holiday name in a date, then leave the
            box to save it.
          </p>
        </div>
        <div className="grid grid-cols-7 gap-2 text-sm">
          {WEEK.map((label, i) => {
            const off = settings?.weeklyOffDays.includes(DOW[i]!);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={!!off}
                className={`rounded-md px-2 py-2 text-left focus-visible:outline focus-visible:outline-2 ${off ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted'}`}
                onClick={() => void toggleOff(DOW[i]!)}
              >
                {label}
                <span className="mt-0.5 block text-xs">{off ? 'Weekly off' : 'Working'}</span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: lead }, (_, i) => (
            <div key={`p${i}`} />
          ))}
          {dates.map((date) => (
            <DayBox key={date} date={date} holiday={byDate.get(date)} onSave={saveDay} />
          ))}
        </div>
      </section>

      <section
        id="leave"
        className="flex flex-col gap-6 rounded-xl border-2 border-teal-500 p-4 sm:p-6"
        aria-labelledby="leave-heading"
      >
        <div>
          <h2 id="leave-heading" className="text-lg font-semibold">
            Leave
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Set how many days the company gives in {y}. Then change one person’s casual leave, or
            carry last year’s unused earned leave forward.
          </p>
        </div>
        <Types types={types} onError={fail} onSaved={() => load(y)} />
        <PersonLeave year={y} types={types} onError={fail} />
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-medium">Carry forward</h3>
          <p className="text-sm text-muted-foreground">
            Moves unused earned leave from {y - 1} into {y}. Running it again does not add the days
            twice.
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => void carry(y - 1)}
          >
            Carry {y - 1} into {y}
          </Button>
        </div>
      </section>
    </div>
  );
}

function DayBox({
  date,
  holiday,
  onSave,
}: {
  date: string;
  holiday: Holiday | undefined;
  onSave: (date: string, name: string) => Promise<void>;
}) {
  const [name, setName] = useState(holiday?.name ?? '');
  const skipSave = useRef(false);
  useEffect(() => setName(holiday?.name ?? ''), [holiday?.name]);
  return (
    <label
      className={`flex min-h-24 flex-col gap-1 rounded-md border p-2 text-sm ${holiday ? 'bg-muted/60' : ''}`}
    >
      <span className="font-medium">{Number(date.slice(8))}</span>
      <input
        aria-label={`Holiday on ${date}`}
        value={name}
        maxLength={80}
        placeholder="Holiday"
        className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2"
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (skipSave.current) {
            skipSave.current = false;
            return;
          }
          void onSave(date, name);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            skipSave.current = true;
            setName(holiday?.name ?? '');
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function quotaOf(type: LeaveType) {
  return type.annualQuota == null ? '' : String(type.annualQuota);
}

function Types({
  types,
  onError,
  onSaved,
}: {
  types: LeaveType[];
  onError: (e: unknown) => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    setDraft(Object.fromEntries(types.map((t) => [t.code, quotaOf(t)])));
  }, [types]);
  const dirty = types.some((t) => !t.grantOnly && (draft[t.code] ?? quotaOf(t)) !== quotaOf(t));

  async function save() {
    for (const type of types) {
      if (type.grantOnly) continue;
      const text = draft[type.code] ?? quotaOf(type);
      if (text === quotaOf(type)) continue;
      const annualQuota = text.trim() === '' ? null : Number(text);
      if (
        annualQuota !== null &&
        (!Number.isFinite(annualQuota) || annualQuota < 0 || (annualQuota * 2) % 1 !== 0)
      ) {
        onError({
          error: {
            code: 'VALIDATION',
            message: `${type.name}: use a number in steps of 0.5, or leave it empty for no limit.`,
          },
        });
        return;
      }
      const r = await api.PUT('/v1/leave/types/{code}', {
        params: { path: { code: type.code } },
        body: { version: type.version, annualQuota },
      });
      if (r.error) return onError(r);
    }
    await onSaved();
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-teal-500 p-4">
      <h3 className="text-base font-medium">Days each person gets</h3>
      {types.map((t) => (
        <label key={t.code} className="flex items-center justify-between gap-3 text-sm">
          <span>
            {t.name} <span className="text-muted-foreground">{t.code}</span>
          </span>
          <Input
            className="w-28"
            inputMode="decimal"
            aria-label={`${t.name} days per year`}
            value={draft[t.code] ?? quotaOf(t)}
            placeholder={t.grantOnly ? 'Granted' : 'No limit'}
            disabled={t.grantOnly}
            onChange={(e) => setDraft((d) => ({ ...d, [t.code]: e.target.value }))}
          />
        </label>
      ))}
      <Button type="button" className="w-fit" disabled={!dirty} onClick={() => void save()}>
        Save
      </Button>
    </div>
  );
}

function PersonLeave({
  year,
  types,
  onError,
}: {
  year: number;
  types: LeaveType[];
  onError: (e: unknown) => void;
}) {
  const choices = types.filter((t) => t.active && (t.annualQuota !== null || t.grantOnly));
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [userId, setUserId] = useState('');
  const [personName, setPersonName] = useState('');
  const [typeCode, setTypeCode] = useState('');
  const [days, setDays] = useState('0.5');
  const [reason, setReason] = useState('');
  const [balance, setBalance] = useState<{ name: string; available: number | null }[]>([]);
  useEffect(() => {
    if (choices.some((t) => t.code === typeCode)) return;
    setTypeCode(choices.find((t) => t.code === 'CL')?.code ?? choices[0]?.code ?? '');
  }, [types]);

  useEffect(() => {
    if (q.trim().length < 2) return setPeople([]);
    const ac = new AbortController();
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/users', {
        params: { query: { q: q.trim(), limit: 8, status: 'active' } },
        signal: ac.signal,
      });
      if (!ac.signal.aborted && r.data)
        setPeople(r.data.items.map((p) => ({ id: p.id, name: p.name })));
    })();
    return () => ac.abort();
  }, [q]);

  async function balanceFor(id: string) {
    const r = await api.GET('/v1/leave/balances', { params: { query: { userId: id, year } } });
    if (r.error) return onError(r);
    setBalance((r.data?.items ?? []).map((i) => ({ name: i.typeName, available: i.available })));
  }

  function pick(id: string, name: string) {
    setUserId(id);
    setPersonName(name);
    setPeople([]);
    setQ('');
    void balanceFor(id);
  }

  async function adjust(sign: 1 | -1) {
    const n = Number(days);
    if (!userId)
      return onError({ error: { code: 'VALIDATION', message: 'Choose a person first.' } });
    if (!typeCode)
      return onError({ error: { code: 'VALIDATION', message: 'Choose a leave category.' } });
    if (!reason.trim())
      return onError({ error: { code: 'VALIDATION', message: 'Add a reason for the change.' } });
    if (!Number.isFinite(n) || n <= 0 || (n * 2) % 1 !== 0)
      return onError({
        error: { code: 'VALIDATION', message: 'Use a number of days in steps of 0.5.' },
      });
    const r = await api.POST('/v1/leave/grants', {
      body: {
        userId,
        typeCode,
        year,
        kind: 'adjustment',
        days: sign * n,
        workedDate: null,
        reason: reason.trim(),
      },
    });
    if (r.error) return onError(r);
    setReason('');
    await balanceFor(userId);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-teal-500 p-4">
      <h3 className="text-base font-medium">One person</h3>
      <p className="text-sm text-muted-foreground">
        Find someone, choose the leave category, then add or remove days for {year}. This changes
        only that person. The change is in half days.
      </p>
      <Input
        aria-label="Find a person"
        placeholder="Find a person"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setUserId('');
          setPersonName('');
          setBalance([]);
        }}
      />
      {people.length > 0 && (
        <ul className="rounded-md border">
          {people.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => pick(p.id, p.name)}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {personName && <p className="text-sm font-medium">{personName}</p>}
      {balance.length > 0 && (
        <ul className="text-sm text-muted-foreground">
          {balance.map((line) => (
            <li key={line.name}>
              {line.name}: {line.available == null ? 'no limit' : line.available}
            </li>
          ))}
        </ul>
      )}
      {userId && choices.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Category
            <select
              aria-label="Leave category"
              className="rounded-md border bg-background px-2 py-2"
              value={typeCode}
              onChange={(e) => setTypeCode(e.target.value)}
            >
              {choices.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <Input
            className="w-28"
            inputMode="decimal"
            aria-label="Days"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <Input
            aria-label="Reason"
            placeholder="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button type="button" onClick={() => void adjust(1)}>
            Add days
          </Button>
          <Button type="button" variant="outline" onClick={() => void adjust(-1)}>
            Remove days
          </Button>
        </div>
      )}
    </div>
  );
}
