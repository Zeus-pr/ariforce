'use client';

import { useEffect, useMemo, useState } from 'react';
import { LeaveMaster } from '@/components/admin/leave-master';
import { Input } from '@ariforce/ui/components/input';
import { api, toApiError } from '@/lib/api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Request = {
  id: string;
  userId: string;
  userName: string;
  typeName: string;
  fromDate: string;
  toDate: string;
  days: number;
  status: string;
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function monthEnd(year: number, month: number) {
  return `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;
}

function overlaps(row: Request, from: string, to: string) {
  return row.fromDate <= to && row.toDate >= from;
}

function dayLabel(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

function rangeLabel(row: Request) {
  return row.fromDate === row.toDate
    ? dayLabel(row.fromDate)
    : `${dayLabel(row.fromDate)} – ${dayLabel(row.toDate)}`;
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function HrLeave() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [day, setDay] = useState<string | null>(null);
  const [person, setPerson] = useState('');
  const [rows, setRows] = useState<Request[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api.GET('/v1/leave/requests', { params: { query: { year } } }).then((r) => {
      if (!live) return;
      if (r.error || !r.data) {
        setError(toApiError(r).message || 'Could not load leave.');
        setRows([]);
        return;
      }
      setError(null);
      setRows(r.data.items as Request[]);
    });
    return () => {
      live = false;
    };
  }, [year]);

  const from = `${year}-${pad(month)}-01`;
  const to = monthEnd(year, month);
  const days = new Date(year, month, 0).getDate();
  const query = person.trim().toLowerCase();

  const inMonth = useMemo(
    () => (rows ?? []).filter((row) => overlaps(row, from, to)),
    [rows, from, to],
  );
  const peopleByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (let d = 1; d <= days; d++) {
      const date = `${year}-${pad(month)}-${pad(d)}`;
      const names = new Set(
        inMonth.filter((row) => overlaps(row, date, date)).map((row) => row.userId),
      );
      map.set(date, names.size);
    }
    return map;
  }, [inMonth, days, year, month]);

  const shown = inMonth.filter((row) => {
    if (day && !overlaps(row, day, day)) return false;
    if (query && !row.userName.toLowerCase().includes(query)) return false;
    return true;
  });
  const people = [...new Map(shown.map((row) => [row.userId, row.userName])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1]),
  );
  const monthPeople = new Set(inMonth.map((row) => row.userId)).size;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Leave</h1>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {rows === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {rows && (
        <section className="flex flex-col gap-4" aria-label="Leave in a month">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md px-2.5 py-1 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2"
              onClick={() => {
                setYear((y) => y - 1);
                setDay(null);
              }}
            >
              {year - 1}
            </button>
            <p className="text-sm font-medium tabular-nums">{year}</p>
            <button
              type="button"
              className="rounded-md px-2.5 py-1 text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2"
              onClick={() => {
                setYear((y) => y + 1);
                setDay(null);
              }}
            >
              {year + 1}
            </button>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Month">
            {MONTHS.map((label, i) => {
              const value = i + 1;
              const on = month === value;
              const start = `${year}-${pad(value)}-01`;
              const end = monthEnd(year, value);
              const count = new Set(
                (rows ?? []).filter((row) => overlaps(row, start, end)).map((row) => row.userId),
              ).size;
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  className={`rounded-md px-2.5 py-1 text-sm focus-visible:outline focus-visible:outline-2 ${on ? 'bg-foreground text-background' : 'hover:bg-muted'}`}
                  onClick={() => {
                    setMonth(value);
                    setDay(null);
                  }}
                >
                  {label}
                  <span className="ml-1 tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>
          <label className="flex max-w-xs flex-col gap-1 text-sm">
            Person
            <Input value={person} placeholder="Name" onChange={(e) => setPerson(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Day">
            {Array.from({ length: days }, (_, i) => {
              const date = `${year}-${pad(month)}-${pad(i + 1)}`;
              const count = peopleByDay.get(date) ?? 0;
              const on = day === date;
              return (
                <button
                  key={date}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${dayLabel(date)}, ${count} ${count === 1 ? 'person' : 'people'}`}
                  className={`flex h-11 w-10 flex-col items-center justify-center rounded-md text-xs tabular-nums focus-visible:outline focus-visible:outline-2 ${on ? 'bg-foreground text-background' : count ? 'bg-muted' : 'hover:bg-muted'}`}
                  onClick={() => setDay(on ? null : date)}
                >
                  <span>{i + 1}</span>
                  {count > 0 ? <span className="leading-none">{count}</span> : null}
                </button>
              );
            })}
          </div>
          <p className="text-sm text-muted-foreground">
            {day
              ? `${dayLabel(day)}. ${people.length} ${people.length === 1 ? 'person' : 'people'}.`
              : query
                ? `${people.length} ${people.length === 1 ? 'person' : 'people'} matching.`
                : `${MONTHS[month - 1]} ${year}. ${monthPeople} ${monthPeople === 1 ? 'person' : 'people'}.`}
          </p>
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leave for this choice.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {people.map(([id, name]) => (
                <li key={id} className="flex flex-col gap-1 px-3 py-3">
                  <p className="text-sm font-medium">{name}</p>
                  <ul className="flex flex-col gap-0.5">
                    {shown
                      .filter((row) => row.userId === id)
                      .map((row) => (
                        <li key={row.id} className="text-sm text-muted-foreground">
                          {rangeLabel(row)} · {row.typeName} · {row.days}{' '}
                          {row.days === 1 ? 'day' : 'days'} · {statusLabel(row.status)}
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <h2 className="pt-2 text-lg font-semibold">Leave setup</h2>
      <p className="text-sm text-muted-foreground">
        Holidays and the number of days people get. Paid leave stays at zero until six months after
        the joining date. Loss of pay is unchanged.
      </p>
      <LeaveMaster />
    </div>
  );
}
