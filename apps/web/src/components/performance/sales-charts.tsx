'use client';

import { Bar } from '@/components/charts/bar';
import { BarChart } from '@/components/charts/bar-chart';
import { BarXAxis } from '@/components/charts/bar-x-axis';
import { BarYAxis } from '@/components/charts/bar-y-axis';
import { chartIndex, ChartFrame, monthDate, SERIES } from '@/components/charts/chart';
import { ComposedChart } from '@/components/charts/composed-chart';
import { Gauge } from '@/components/charts/gauge';
import { Grid } from '@/components/charts/grid';
import { Line } from '@/components/charts/line';
import { SeriesBar } from '@/components/charts/series-bar';
import { ChartTooltip } from '@/components/charts/tooltip/chart-tooltip';
import { XAxis } from '@/components/charts/x-axis';
import { YAxis } from '@/components/charts/y-axis';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { inr } from './perf-ui';

const lakh = (value: number) => `₹${(value / 1e5).toFixed(1)}L`;

function moneyRows(
  rows: { name: string; primary: number; secondary: number }[],
  extra?: (row: {
    name: string;
    primary: number;
    secondary: number;
  }) => { label: string; value: string }[],
) {
  return rows.map((row) => ({
    name: row.name,
    cells: [
      { label: 'Primary', value: inr(row.primary) },
      { label: 'Secondary', value: inr(row.secondary) },
      ...(extra?.(row) ?? []),
    ],
  }));
}

export function SalesGauges({
  primary,
  primaryTarget,
  secondary,
  secondaryTarget,
}: {
  primary: number;
  primaryTarget: number;
  secondary: number;
  secondaryTarget: number;
}) {
  const gauges = [
    { label: 'Primary', actual: primary, target: primaryTarget, color: SERIES[0] },
    { label: 'Secondary', actual: secondary, target: secondaryTarget, color: SERIES[6] },
  ]
    .filter((gauge) => gauge.target > 0 || gauge.actual > 0)
    .map((gauge) => ({
      ...gauge,
      pct:
        gauge.target > 0
          ? Math.round((gauge.actual / gauge.target) * 100)
          : gauge.actual > 0
            ? 100
            : 0,
    }));
  if (gauges.length === 0) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {gauges.map((gauge) => {
        return (
          <section key={gauge.label} className="rounded-xl border bg-card p-4 shadow-xs">
            <ChartFrame label={`${gauge.label} ${gauge.pct}% of target`}>
              <Gauge
                value={Math.max(0, Math.min(100, gauge.pct))}
                centerValue={gauge.pct}
                suffix="%"
                defaultLabel={gauge.label}
                needle
                activeFill={gauge.color}
                className="mx-auto max-w-sm"
              />
              <p className="text-center text-xs text-muted-foreground tabular-nums">
                {inr(gauge.actual)}
                {gauge.target > 0 ? ` of ${inr(gauge.target)}` : ''}
              </p>
            </ChartFrame>
          </section>
        );
      })}
    </div>
  );
}

export function SalesTrendChart({
  trend,
  onMonth,
  linesOnly = false,
}: {
  trend: {
    name: string;
    month?: string;
    primary: number | null;
    secondary: number | null;
    target: number | null;
    secondaryTarget?: number | null;
  }[];
  onMonth?: (month: string) => void;
  linesOnly?: boolean;
}) {
  const reduced = useReducedMotion();
  const data = trend.map((point) => ({
    date: monthDate(point.month, point.name),
    primary: point.primary ?? 0,
    secondary: point.secondary ?? 0,
    target: point.target ?? 0,
    secondaryTarget: point.secondaryTarget ?? 0,
  }));
  return (
    <ChartFrame
      height={240}
      label="Sales against target, six months"
      rows={trend.map((point) => ({
        name: point.name,
        cells: [
          { label: 'Primary', value: inr(point.primary ?? 0) },
          { label: 'Secondary', value: inr(point.secondary ?? 0) },
          { label: 'Primary target', value: inr(point.target ?? 0) },
          { label: 'Secondary target', value: inr(point.secondaryTarget ?? 0) },
        ],
      }))}
    >
      <div
        className="h-full"
        onClick={
          onMonth
            ? (event) => {
                const index = chartIndex(event, trend.length, 'x');
                const month = trend[index]?.month;
                if (month) onMonth(month);
              }
            : undefined
        }
      >
        <ComposedChart
          data={data}
          xDataKey="date"
          aspectRatio=""
          className="h-full"
          animationDuration={reduced ? 0 : 800}
        >
          <Grid vertical={false} />
          {!linesOnly && <SeriesBar dataKey="primary" fill={SERIES[0]} radius={3} />}
          {!linesOnly && <SeriesBar dataKey="secondary" fill={SERIES[6]} radius={3} />}
          <Line
            dataKey={linesOnly ? 'primary' : 'target'}
            stroke={linesOnly ? SERIES[0] : SERIES[2]}
            strokeWidth={2}
            fadeEdges={false}
          />
          <Line
            dataKey={linesOnly ? 'secondary' : 'secondaryTarget'}
            stroke={linesOnly ? SERIES[6] : SERIES[3]}
            strokeWidth={2}
            fadeEdges={false}
          />
          <XAxis />
          <YAxis formatValue={lakh} />
          <ChartTooltip
            rows={(point) => [
              { color: SERIES[0], label: 'Primary', value: inr(Number(point.primary ?? 0)) },
              { color: SERIES[6], label: 'Secondary', value: inr(Number(point.secondary ?? 0)) },
              { color: SERIES[2], label: 'Primary target', value: inr(Number(point.target ?? 0)) },
              {
                color: SERIES[3],
                label: 'Secondary target',
                value: inr(Number(point.secondaryTarget ?? 0)),
              },
            ]}
          />
        </ComposedChart>
      </div>
      {onMonth && (
        <div className="sr-only">
          {trend.map(
            (point) =>
              point.month && (
                <button key={point.month} type="button" onClick={() => onMonth(point.month!)}>
                  Open {point.name}
                </button>
              ),
          )}
        </div>
      )}
    </ChartFrame>
  );
}

export function YearCompareChart({
  years,
  label = 'This year and last year',
  height = 240,
}: {
  years: { year: string; primary: number; secondary: number }[];
  label?: string;
  height?: number;
}) {
  const reduced = useReducedMotion();
  const data = years.map((year) => ({ name: year.year, ...year }));
  return (
    <ChartFrame
      height={height}
      label={label}
      rows={moneyRows(years.map((year) => ({ name: year.year, ...year })))}
    >
      <BarChart
        data={data}
        xDataKey="name"
        aspectRatio=""
        className="h-full"
        animationDuration={reduced ? 0 : 700}
        margin={{ top: 12, right: 8, bottom: 28, left: 8 }}
      >
        <Bar dataKey="primary" fill={SERIES[0]} showValue valueLabelFormatter={lakh} />
        <Bar dataKey="secondary" fill={SERIES[6]} showValue valueLabelFormatter={lakh} />
        <BarXAxis showAllLabels />
        <ChartTooltip
          showDatePill={false}
          rows={(point) => [
            { color: SERIES[0], label: 'Primary', value: inr(Number(point.primary ?? 0)) },
            { color: SERIES[6], label: 'Secondary', value: inr(Number(point.secondary ?? 0)) },
          ]}
        />
      </BarChart>
    </ChartFrame>
  );
}

export function PlaceCompareChart({
  places,
  onOpen,
  label = 'Places, primary and secondary',
}: {
  places: { id: string; name: string; primary: number; secondary: number }[];
  onOpen?: (id: string) => void;
  label?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <ChartFrame
      height={Math.max(180, places.length * 64 + 36)}
      label={label}
      rows={moneyRows(places)}
    >
      <div
        className="h-full"
        onClick={
          onOpen
            ? (event) => {
                const index = chartIndex(event, places.length, 'y');
                const id = places[index]?.id;
                if (id) onOpen(id);
              }
            : undefined
        }
      >
        <BarChart
          data={places}
          xDataKey="name"
          orientation="horizontal"
          aspectRatio=""
          className="h-full"
          animationDuration={reduced ? 0 : 700}
          margin={{ top: 8, right: 16, bottom: 8, left: 128 }}
        >
          <Bar dataKey="primary" fill={SERIES[0]} />
          <Bar dataKey="secondary" fill={SERIES[6]} />
          <BarYAxis />
          <ChartTooltip
            showDatePill={false}
            rows={(point) => [
              { color: SERIES[0], label: 'Primary', value: inr(Number(point.primary ?? 0)) },
              { color: SERIES[6], label: 'Secondary', value: inr(Number(point.secondary ?? 0)) },
            ]}
          />
        </BarChart>
      </div>
    </ChartFrame>
  );
}

export function ProductColumnChart({
  places,
  label,
}: {
  places: { id: string; name: string; primary: number; secondary: number }[];
  label: string;
}) {
  const reduced = useReducedMotion();
  const wide = Math.max(places.length * 64, 320);
  return (
    <div className="min-w-0 overflow-x-auto">
      <div style={{ width: places.length > 8 ? wide : '100%', minWidth: '100%' }}>
        <ChartFrame height={440} label={label} rows={moneyRows(places)}>
          <BarChart
            data={places}
            xDataKey="name"
            aspectRatio=""
            className="h-full"
            animationDuration={reduced ? 0 : 700}
            margin={{ top: 16, right: 16, bottom: 112, left: 88 }}
          >
            <Bar dataKey="primary" fill={SERIES[0]} />
            <Bar dataKey="secondary" fill={SERIES[6]} />
            <BarXAxis slant showAllLabels maxLabels={places.length} />
            <YAxis formatValue={lakh} />
            <ChartTooltip
              showDatePill={false}
              rows={(point) => [
                { color: SERIES[0], label: 'Primary', value: inr(Number(point.primary ?? 0)) },
                { color: SERIES[6], label: 'Secondary', value: inr(Number(point.secondary ?? 0)) },
              ]}
            />
          </BarChart>
        </ChartFrame>
      </div>
    </div>
  );
}

export type LiquidItem = {
  id: string;
  name: string;
  primary: number;
  secondary: number;
  primaryTarget: number;
  secondaryTarget: number;
  priorPrimary?: number;
  priorSecondary?: number;
};

function tankRows(items: LiquidItem[], kind: 'primary' | 'secondary') {
  return items.map((item) => {
    const actual = kind === 'primary' ? item.primary : item.secondary;
    const target = kind === 'primary' ? item.primaryTarget : item.secondaryTarget;
    const cap = target > 0 ? target : actual;
    const met = Math.min(actual, cap);
    const over = Math.max(0, actual - cap);
    const open = Math.max(0, (target > 0 ? target : 0) - actual);
    const pct = target > 0 ? `${Math.round((actual / target) * 100)}%` : actual > 0 ? '100%' : '0%';
    return {
      id: item.id,
      name: item.name,
      met,
      over,
      open,
      metPct: met > 0 ? pct : '',
      openPct: met === 0 ? pct : '',
      actual,
      target,
    };
  });
}

function TankChart({
  items,
  kind,
  onOpen,
}: {
  items: LiquidItem[];
  kind: 'primary' | 'secondary';
  onOpen?: (id: string) => void;
}) {
  const reduced = useReducedMotion();
  const solid = kind === 'primary' ? SERIES[0] : SERIES[6];
  const pale = `color-mix(in oklch, ${solid} 20%, white)`;
  const deep = `color-mix(in oklch, ${solid} 72%, black)`;
  const rows = tankRows(items, kind);
  const wide = Math.max(items.length * 64, 320);
  const label = kind === 'primary' ? 'Primary' : 'Secondary';
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium" style={{ color: solid }}>
        {label}
      </p>
      <div className="min-w-0 overflow-x-auto">
        <div style={{ width: items.length > 8 ? wide : '100%', minWidth: '100%' }}>
          <ChartFrame
            height={500}
            label={`${label} filled against target`}
            rows={rows.map((row) => ({
              name: row.name,
              cells: [
                { label: 'Achieved', value: inr(row.actual) },
                { label: 'Target', value: inr(row.target) },
                { label: 'Filled', value: row.metPct || row.openPct || '—' },
              ],
            }))}
          >
            <div
              className="h-full"
              onClick={
                onOpen
                  ? (event) => {
                      const index = chartIndex(event, rows.length, 'x');
                      const id = rows[index]?.id;
                      if (id) onOpen(id);
                    }
                  : undefined
              }
            >
              <BarChart
                data={rows}
                xDataKey="name"
                stacked
                aspectRatio=""
                className="h-full"
                animationDuration={reduced ? 0 : 700}
                margin={{ top: 12, right: 12, bottom: 120, left: 96 }}
              >
                <Bar
                  dataKey="met"
                  fill={solid}
                  lineCap={0}
                  showValue
                  valueLabelKey="metPct"
                  valueLabelOrientation="vertical"
                />
                <Bar dataKey="over" fill={deep} lineCap={0} />
                <Bar
                  dataKey="open"
                  fill={pale}
                  lineCap={3}
                  showValue
                  valueLabelKey="openPct"
                  valueLabelColor={solid}
                  valueLabelOrientation="vertical"
                />
                <BarXAxis slant showAllLabels maxLabels={rows.length} />
                <YAxis formatValue={lakh} />
                <ChartTooltip
                  showDatePill={false}
                  rows={(point) => [
                    { color: solid, label: 'Achieved', value: inr(Number(point.actual ?? 0)) },
                    { color: pale, label: 'Target', value: inr(Number(point.target ?? 0)) },
                    {
                      color: solid,
                      label: 'Filled',
                      value: String(point.metPct || point.openPct || '—'),
                    },
                  ]}
                />
              </BarChart>
            </div>
          </ChartFrame>
        </div>
      </div>
    </div>
  );
}

/** Filled columns for a place, product, or person. The name still opens the place. */
export function LiquidColumns({
  items,
  onOpen,
}: {
  items: LiquidItem[];
  onOpen?: (id: string) => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <TankChart items={items} kind="primary" onOpen={onOpen} />
      <TankChart items={items} kind="secondary" onOpen={onOpen} />
    </div>
  );
}
