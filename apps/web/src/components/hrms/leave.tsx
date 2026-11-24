'use client';

import { useEffect, useMemo, useState } from 'react';
import { LeaveMaster } from '@/components/admin/leave-master';
import { Bar } from '@/components/charts/bar';
import { BarChart } from '@/components/charts/bar-chart';
import { BarXAxis } from '@/components/charts/bar-x-axis';
import { ChartFrame, SERIES } from '@/components/charts/chart';
import { Grid } from '@/components/charts/grid';
import { PieChart } from '@/components/charts/pie-chart';
import { PieSlice } from '@/components/charts/pie-slice';
import { ChartTooltip } from '@/components/charts/tooltip/chart-tooltip';
import { Input } from '@ariforce/ui/components/input';
import { api, toApiError } from '@/lib/api';
import { useReducedMotion } from '@/lib/use-reduced-motion';

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
  const reduced = useReducedMotion();
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
  const named = useMemo(
    () => inMonth.filter((row) => !query || row.userName.toLowerCase().includes(query)),
    [inMonth, query],
  );
  const byDay = useMemo(() => {
    return Array.from({ length: days }, (_, i) => {
      const date = `${year}-${pad(month)}-${pad(i + 1)}`;
      const people = new Set(
        named.filter((row) => overlaps(row, date, date)).map((row) => row.userId),
      ).size;
      return { name: String(i + 1), date, people };
    });
  }, [named, days, year, month]);
  const chartHasPeople = byDay.some((item) => item.people > 0);
  const shown = named.filter((row) => !day || overlaps(row, day, day));
  const people = [...new Map(shown.map((row) => [row.userId, row.userName])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1]),
  );
  const addDays = (map: Map<string, number>, key: string, days: number) =>
    map.set(key, (map.get(key) ?? 0) + days);
  const types = [
    ...named.reduce((map, row) => addDays(map, row.typeName, row.days), new Map<string, number>()),
  ].map(([name, value]) => ({ name, value }));
  const statuses = [
    ...named.reduce(
      (map, row) => addDays(map, statusLabel(row.status), row.days),
      new Map<string, number>(),
    ),
  ].map(([name, value]) => ({ name, value }));
  const split = types.length > 1 ? types : statuses.length > 1 ? statuses : [];
  const splitLabel = types.length > 1 ? 'Days by type' : 'Days by status';

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
        <section
          className="flex flex-col gap-4 rounded-lg border bg-card p-4"
          aria-label="Leave in a month"
        >
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
          {chartHasPeople && (
            <ChartFrame
              height={180}
              label={`People off each day in ${MONTHS[month - 1]} ${year}`}
              rows={byDay.map((item) => ({
                name: item.date,
                cells: [{ label: 'People', value: String(item.people) }],
              }))}
            >
              <BarChart
                data={byDay}
                xDataKey="name"
                aspectRatio=""
                className="h-full"
                animationDuration={reduced ? 0 : 700}
                margin={{ top: 8, right: 8, bottom: 24, left: 28 }}
              >
                <Grid vertical={false} />
                <Bar dataKey="people" fill={SERIES[0]} />
                <BarXAxis />
                <ChartTooltip
                  showDatePill={false}
                  rows={(point) => [
                    { color: SERIES[0], label: 'People', value: Number(point.people ?? 0) },
                  ]}
                />
              </BarChart>
            </ChartFrame>
          )}
          <div className="flex flex-wrap gap-1" role="group" aria-label="Day">
            {byDay.map((item) => {
              const on = day === item.date;
              return (
                <button
                  key={item.date}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${dayLabel(item.date)}, ${item.people} ${item.people === 1 ? 'person' : 'people'}`}
                  className={`h-8 min-w-8 rounded-md px-1 text-xs tabular-nums focus-visible:outline focus-visible:outline-2 ${on ? 'bg-foreground text-background' : item.people ? 'bg-muted' : 'hover:bg-muted'}`}
                  onClick={() => setDay(on ? null : item.date)}
                >
                  {item.name}
                </button>
              );
            })}
          </div>
          <p className="text-sm text-muted-foreground">
            {day
              ? `${dayLabel(day)}. ${people.length} ${people.length === 1 ? 'person' : 'people'}.`
              : query
                ? `${people.length} ${people.length === 1 ? 'person' : 'people'} matching.`
                : `${MONTHS[month - 1]} ${year}. ${new Set(inMonth.map((row) => row.userId)).size} ${new Set(inMonth.map((row) => row.userId)).size === 1 ? 'person' : 'people'}.`}
          </p>
          {split.length > 1 && (
            <div className="grid items-center gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
              <ChartFrame
                height={140}
                label={splitLabel}
                rows={split.map((item) => ({
                  name: item.name,
                  cells: [{ label: 'Days', value: String(item.value) }],
                }))}
              >
                <PieChart
                  className="h-full"
                  data={split.map((item, index) => ({
                    label: item.name,
                    value: item.value,
                    color: SERIES[index % SERIES.length],
                  }))}
                  innerRadius={36}
                  padAngle={0.02}
                  cornerRadius={4}
                >
                  {split.map((item, index) => (
                    <PieSlice key={item.name} index={index} />
                  ))}
                </PieChart>
              </ChartFrame>
              <ul className="flex flex-col gap-1.5 text-xs">
                {split.map((item, index) => (
                  <li key={item.name} className="flex items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: SERIES[index % SERIES.length] }}
                    />
                    <span className="text-muted-foreground">{item.name}</span>
                    <span className="ml-auto tabular-nums">
                      {item.value} {item.value === 1 ? 'day' : 'days'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leave for this choice.</p>
          ) : (
            <ul className="flex flex-col divide-y border-t">
              {people.map(([id, name]) => (
                <li key={id} className="flex flex-col gap-1 py-3">
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
