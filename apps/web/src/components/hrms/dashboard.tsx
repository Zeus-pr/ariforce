'use client';

import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import { axisProps, CHART, ChartFrame, ChartTooltip } from '@/components/charts/chart';
import { listPeople, type Person } from '@/lib/people/adapter';
import { useReducedMotion } from '@/lib/use-reduced-motion';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function everyone() {
  const rows: Person[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await listPeople({ cursor, limit: 50 });
    rows.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return rows;
}

function yearOf(iso: string | null | undefined) {
  if (!iso) return null;
  const y = Number(iso.slice(0, 4));
  return Number.isFinite(y) && iso.length >= 4 ? y : null;
}

function monthOf(iso: string | null | undefined) {
  if (!iso) return null;
  const m = Number(iso.slice(5, 7));
  return m >= 1 && m <= 12 ? m : null;
}

function inQuarter(iso: string | null | undefined, year: number, quarter: number) {
  const y = yearOf(iso);
  const m = monthOf(iso);
  if (y !== year || !m) return false;
  return Math.floor((m - 1) / 3) + 1 === quarter;
}

function ageOf(iso: string | null | undefined, now: Date) {
  const y = yearOf(iso);
  const m = monthOf(iso);
  if (!y || !m) return null;
  let age = now.getFullYear() - y;
  if (m - 1 > now.getMonth()) age -= 1;
  return age;
}

function tally(people: Person[], labelOf: (p: Person) => string) {
  const map = new Map<string, number>();
  for (const p of people) {
    const label = labelOf(p).trim();
    if (!label) continue;
    map.set(label, (map.get(label) ?? 0) + 1);
  }
  return [...map.entries()].map(([name, value]) => ({ name, value }));
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-xs">
        —
      </span>
      No data yet
    </div>
  );
}

function Donut({ title, data }: { title: string; data: { name: string; value: number }[] }) {
  const reduced = useReducedMotion();
  const total = data.reduce((n, d) => n + d.value, 0);
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      {total === 0 ? (
        <Empty />
      ) : (
        <div className="mt-2 grid items-center gap-2 sm:grid-cols-[1fr_auto]">
          <ChartFrame height={200} label={title}>
            <PieChart>
              <ChartTooltip />
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={52}
                outerRadius={78}
                paddingAngle={2}
                isAnimationActive={!reduced}
                animationDuration={800}
                animationEasing="ease-out"
              >
                {data.map((d, i) => (
                  <Cell key={d.name} fill={CHART.series[i % CHART.series.length]} />
                ))}
              </Pie>
            </PieChart>
          </ChartFrame>
          <ul className="flex flex-col gap-1.5 text-xs">
            {data.map((d, i) => (
              <li key={d.name} className="flex items-center gap-2">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: CHART.series[i % CHART.series.length] }}
                />
                <span className="text-muted-foreground">{d.name}</span>
                <span className="ml-auto tabular-nums">{d.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function HrDashboard() {
  const reduced = useReducedMotion();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const year = now.getFullYear();
  const quarter = Math.floor(now.getMonth() / 3) + 1;

  useEffect(() => {
    let live = true;
    void everyone()
      .then((rows) => live && setPeople(rows))
      .catch(
        (e) => live && setError(e instanceof Error ? e.message : 'Could not load the dashboard.'),
      );
    return () => {
      live = false;
    };
  }, []);

  const rows = people ?? [];
  const current = rows.filter((p) => p.hrStatus !== 'Left' && p.status !== 'rejected');
  const hired = rows.filter((p) => yearOf(p.joinedOn) === year).length;
  const exited = rows.filter((p) => yearOf(p.relievingDate) === year).length;
  const joiningQuarter = rows.filter((p) => inQuarter(p.joinedOn, year, quarter)).length;
  const relievingQuarter = rows.filter((p) => inQuarter(p.relievingDate, year, quarter)).length;
  const trend = MONTHS.map((name, i) => ({
    name,
    Hires: rows.filter((p) => yearOf(p.joinedOn) === year && monthOf(p.joinedOn) === i + 1).length,
    Exits: rows.filter(
      (p) => yearOf(p.relievingDate) === year && monthOf(p.relievingDate) === i + 1,
    ).length,
  }));
  const trendEmpty = trend.every((m) => m.Hires === 0 && m.Exits === 0);
  const ages = [
    { name: 'Under 25', value: 0 },
    { name: '25–34', value: 0 },
    { name: '35–44', value: 0 },
    { name: '45–54', value: 0 },
    { name: '55 and over', value: 0 },
  ];
  for (const p of current) {
    const age = ageOf(p.dateOfBirth, now);
    if (age == null || age < 0) continue;
    const band = age < 25 ? 0 : age < 35 ? 1 : age < 45 ? 2 : age < 55 ? 3 : 4;
    ages[band]!.value += 1;
  }
  const ageEmpty = ages.every((a) => a.value === 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <p className="text-sm text-muted-foreground">
        <span className="text-foreground">Dashboard</span>
        <span> / Human Resource</span>
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {people === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {people && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Stat label="Total Employees" value={current.length} />
            <Stat label="New Hires (This Year)" value={hired} />
            <Stat label="Employee Exits (This Year)" value={exited} />
            <Stat label="Employees Joining (This Quarter)" value={joiningQuarter} />
            <Stat label="Employees Relieving (This Quarter)" value={relievingQuarter} />
          </div>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">Hiring vs Attrition Count</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{year}</p>
            {trendEmpty ? (
              <Empty />
            ) : (
              <ChartFrame height={240} label="Hires and exits by month" className="mt-2">
                <LineChart data={trend} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-border)" />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis {...axisProps} width={28} allowDecimals={false} domain={[0, 'auto']} />
                  <ChartTooltip />
                  <Line
                    type="monotone"
                    dataKey="Hires"
                    stroke={CHART.primary}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={!reduced}
                    animationDuration={900}
                    animationEasing="ease-out"
                  />
                  <Line
                    type="monotone"
                    dataKey="Exits"
                    stroke={CHART.medium}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={!reduced}
                    animationDuration={1100}
                    animationEasing="ease-out"
                  />
                </LineChart>
              </ChartFrame>
            )}
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">Employees by Age</h2>
            {ageEmpty ? (
              <Empty />
            ) : (
              <ChartFrame height={240} label="Employees by age band" className="mt-2">
                <BarChart data={ages} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-border)" />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis {...axisProps} width={28} allowDecimals={false} domain={[0, 'auto']} />
                  <ChartTooltip />
                  <Bar
                    dataKey="value"
                    name="Employees"
                    fill={CHART.primary}
                    radius={[6, 6, 0, 0]}
                    isAnimationActive={!reduced}
                    animationDuration={900}
                    animationEasing="ease-out"
                  />
                </BarChart>
              </ChartFrame>
            )}
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <Donut title="Gender Diversity Ratio" data={tally(current, (p) => p.gender ?? '')} />
            <Donut title="Employees by Type" data={tally(current, (p) => p.employmentType ?? '')} />
            <Donut title="Employees by Grade" data={tally(current, (p) => p.grade ?? '')} />
            <Donut title="Employees by Branch" data={tally(current, (p) => p.branch ?? '')} />
            <Donut
              title="Designation Wise Employee Count"
              data={tally(current, (p) => p.designation ?? '')}
            />
            <Donut
              title="Department Wise Employee Count"
              data={tally(current, (p) => p.department ?? '')}
            />
          </div>
        </>
      )}
    </div>
  );
}
