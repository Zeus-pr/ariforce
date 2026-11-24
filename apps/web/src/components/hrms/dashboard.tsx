'use client';

import { useEffect, useState } from 'react';
import { Area } from '@/components/charts/area';
import { AreaChart } from '@/components/charts/area-chart';
import { Bar } from '@/components/charts/bar';
import { BarChart } from '@/components/charts/bar-chart';
import { BarXAxis } from '@/components/charts/bar-x-axis';
import { ChartFrame, contributionColumns, monthDate, SERIES } from '@/components/charts/chart';
import { Grid } from '@/components/charts/grid';
import { HeatmapCells } from '@/components/charts/heatmap/heatmap-cells';
import { HeatmapChart } from '@/components/charts/heatmap/heatmap-chart';
import { HeatmapLegend } from '@/components/charts/heatmap/heatmap-legend';
import { HeatmapTooltip } from '@/components/charts/heatmap/heatmap-tooltip';
import { HeatmapXAxis } from '@/components/charts/heatmap/heatmap-x-axis';
import { HeatmapYAxis } from '@/components/charts/heatmap/heatmap-y-axis';
import { PieChart } from '@/components/charts/pie-chart';
import { PieSlice } from '@/components/charts/pie-slice';
import { ChartTooltip } from '@/components/charts/tooltip/chart-tooltip';
import { XAxis } from '@/components/charts/x-axis';
import { YAxis } from '@/components/charts/y-axis';
import { listPeople, type Person } from '@/lib/people/adapter';
import { roleLabel } from '@/lib/roles';
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

function Donut({ title, data }: { title: string; data: { name: string; value: number }[] }) {
  const slices = data.filter((item) => item.value > 0);
  const total = slices.reduce((n, item) => n + item.value, 0);
  if (total === 0) return null;
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="mt-2 grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <ChartFrame
          height={200}
          label={title}
          rows={slices.map((item) => ({
            name: item.name,
            cells: [{ label: 'People', value: String(item.value) }],
          }))}
        >
          <PieChart
            className="h-full"
            data={slices.map((item, index) => ({
              label: item.name,
              value: item.value,
              color: SERIES[index % SERIES.length],
            }))}
            innerRadius={52}
            padAngle={0.02}
            cornerRadius={4}
          >
            {slices.map((item, index) => (
              <PieSlice key={item.name} index={index} />
            ))}
          </PieChart>
        </ChartFrame>
        <ul className="flex flex-col gap-1.5 text-xs">
          {slices.map((item, index) => (
            <li key={item.name} className="flex items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: SERIES[index % SERIES.length] }}
              />
              <span className="text-muted-foreground">{item.name}</span>
              <span className="ml-auto tabular-nums">{item.value}</span>
            </li>
          ))}
        </ul>
      </div>
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

          {!trendEmpty && (
            <section className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-medium">Hiring vs Attrition Count</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{year}</p>
              <ChartFrame
                height={240}
                label="Hires and exits by month"
                className="mt-2"
                rows={trend.map((month) => ({
                  name: month.name,
                  cells: [
                    { label: 'Hires', value: String(month.Hires) },
                    { label: 'Exits', value: String(month.Exits) },
                  ],
                }))}
              >
                <AreaChart
                  data={trend.map((month, index) => ({
                    date: monthDate(`${year}-${String(index + 1).padStart(2, '0')}`, month.name),
                    Hires: month.Hires,
                    Exits: month.Exits,
                  }))}
                  xDataKey="date"
                  aspectRatio=""
                  className="h-full"
                  animationDuration={reduced ? 0 : 800}
                >
                  <Grid vertical={false} />
                  <Area dataKey="Hires" fill={SERIES[5]} stroke={SERIES[5]} fadeEdges={false} />
                  <Area dataKey="Exits" fill={SERIES[3]} stroke={SERIES[3]} fadeEdges={false} />
                  <XAxis />
                  <YAxis />
                  <ChartTooltip
                    rows={(point) => [
                      { color: SERIES[5], label: 'Hires', value: Number(point.Hires ?? 0) },
                      { color: SERIES[3], label: 'Exits', value: Number(point.Exits ?? 0) },
                    ]}
                  />
                </AreaChart>
              </ChartFrame>
            </section>
          )}

          {!ageEmpty && (
            <section className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-medium">Employees by Age</h2>
              <ChartFrame
                height={240}
                label="Employees by age band"
                className="mt-2"
                rows={ages.map((band) => ({
                  name: band.name,
                  cells: [{ label: 'Employees', value: String(band.value) }],
                }))}
              >
                <BarChart
                  data={ages}
                  xDataKey="name"
                  aspectRatio=""
                  className="h-full"
                  animationDuration={reduced ? 0 : 700}
                  margin={{ top: 12, right: 8, bottom: 28, left: 28 }}
                >
                  <Grid vertical={false} />
                  <Bar dataKey="value" fill={SERIES[2]} />
                  <BarXAxis showAllLabels />
                  <ChartTooltip
                    showDatePill={false}
                    rows={(point) => [
                      { color: SERIES[2], label: 'Employees', value: Number(point.value ?? 0) },
                    ]}
                  />
                </BarChart>
              </ChartFrame>
            </section>
          )}

          {current.some((person) => person.joinedOn?.startsWith(String(year))) && (
            <section className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-medium">Joining days, {year}</h2>
              <div className="mt-2">
                <ChartFrame label={`Days people joined in ${year}`}>
                  <HeatmapChart
                    data={contributionColumns(
                      current.flatMap((person) =>
                        person.joinedOn?.startsWith(String(year)) ? [person.joinedOn] : [],
                      ),
                      new Date(year, 0, 1),
                      new Date(year, 11, 31),
                    )}
                    layout="fluid"
                  >
                    <HeatmapCells />
                    <HeatmapXAxis />
                    <HeatmapYAxis />
                    <HeatmapLegend />
                    <HeatmapTooltip />
                  </HeatmapChart>
                </ChartFrame>
              </div>
            </section>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <Donut
              title="Employees by Role"
              data={tally(current, (p) => roleLabel(p.primaryRole ?? p.roles[0]))}
            />
            <Donut
              title="Employees by Status"
              data={tally(current, (p) => p.hrStatus ?? p.status)}
            />
            <Donut title="Gender Diversity Ratio" data={tally(current, (p) => p.gender ?? '')} />
            <Donut title="Employees by Type" data={tally(current, (p) => p.employmentType ?? '')} />
            <Donut title="Employees by Grade" data={tally(current, (p) => p.grade ?? '')} />
            <Donut title="Employees by Branch" data={tally(current, (p) => p.branch ?? '')} />
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
