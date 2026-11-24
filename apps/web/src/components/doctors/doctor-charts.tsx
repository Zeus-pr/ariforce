'use client';

import { Bar } from '@/components/charts/bar';
import { BarChart } from '@/components/charts/bar-chart';
import { BarXAxis } from '@/components/charts/bar-x-axis';
import { ChartFrame, contributionColumns, SERIES } from '@/components/charts/chart';
import { FunnelChart } from '@/components/charts/funnel-chart';
import { Gauge } from '@/components/charts/gauge';
import { Grid } from '@/components/charts/grid';
import { HeatmapCells } from '@/components/charts/heatmap/heatmap-cells';
import { HeatmapChart } from '@/components/charts/heatmap/heatmap-chart';
import { HeatmapLegend } from '@/components/charts/heatmap/heatmap-legend';
import { HeatmapTooltip } from '@/components/charts/heatmap/heatmap-tooltip';
import { HeatmapXAxis } from '@/components/charts/heatmap/heatmap-x-axis';
import { HeatmapYAxis } from '@/components/charts/heatmap/heatmap-y-axis';
import { Scatter } from '@/components/charts/scatter';
import { ScatterChart } from '@/components/charts/scatter-chart';
import { ChartTooltip } from '@/components/charts/tooltip/chart-tooltip';
import { XAxis } from '@/components/charts/x-axis';
import { YAxis } from '@/components/charts/y-axis';
import { useReducedMotion } from '@/lib/use-reduced-motion';

const inr = (value: number) =>
  value.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function VisitsChart({ monthly }: { monthly: { name: string; visits: number }[] }) {
  const reduced = useReducedMotion();
  return (
    <ChartFrame
      height={170}
      label="Visits per month"
      rows={monthly.map((month) => ({
        name: month.name,
        cells: [{ label: 'Visits', value: String(month.visits) }],
      }))}
    >
      <BarChart
        data={monthly}
        xDataKey="name"
        aspectRatio=""
        className="h-full"
        animationDuration={reduced ? 0 : 700}
        margin={{ top: 16, right: 8, bottom: 28, left: 28 }}
      >
        <Grid vertical={false} />
        <Bar dataKey="visits" fill={SERIES[0]} />
        <BarXAxis showAllLabels />
        <ChartTooltip
          showDatePill={false}
          rows={(point) => [
            { color: SERIES[0], label: 'Visits', value: Number(point.visits ?? 0) },
          ]}
        />
      </BarChart>
    </ChartFrame>
  );
}

export function VisitGauge({ visits, target }: { visits: number; target: number }) {
  if (target <= 0) return null;
  const pct = Math.max(0, Math.min(100, Math.round((visits / target) * 100)));
  return (
    <ChartFrame height={160} label={`Visits this month, ${pct}% of the category target`}>
      <Gauge
        value={pct}
        centerValue={pct}
        suffix="%"
        defaultLabel={`${visits} of ${target}`}
        arcStyle="solid"
        progressRing
        activeFill={SERIES[0]}
        className="h-full"
      />
    </ChartFrame>
  );
}

export function VisitHeatmap({ dates, from, to }: { dates: string[]; from: Date; to: Date }) {
  const data = contributionColumns(dates, from, to);
  if (data.length === 0) return null;
  return (
    <ChartFrame label="Visits by day">
      <HeatmapChart data={data} layout="fluid">
        <HeatmapCells />
        <HeatmapXAxis />
        <HeatmapYAxis />
        <HeatmapLegend />
        <HeatmapTooltip />
      </HeatmapChart>
    </ChartFrame>
  );
}

export function VisitFunnel({
  visits,
  detailed,
  orders,
}: {
  visits: number;
  detailed: number;
  orders: number;
}) {
  if (visits <= 0) return null;
  return (
    <ChartFrame height={180} label="Visits, detailed calls, and orders">
      <FunnelChart
        className="h-full"
        data={[
          { label: 'Visits', value: visits, color: SERIES[0] },
          { label: 'Detailed', value: detailed, color: SERIES[2] },
          { label: 'Orders', value: orders, color: SERIES[5] },
        ]}
      />
    </ChartFrame>
  );
}

export function OrderScatter({ points }: { points: { date: string; pob: number }[] }) {
  const reduced = useReducedMotion();
  if (points.length < 2) return null;
  const data = points.map((point) => ({
    date: new Date(`${point.date.slice(0, 10)}T12:00:00`),
    pob: point.pob,
  }));
  return (
    <ChartFrame height={180} label="Order value by visit">
      <ScatterChart
        data={data}
        xDataKey="date"
        aspectRatio=""
        className="h-full"
        animationDuration={reduced ? 0 : 700}
      >
        <Grid vertical={false} />
        <Scatter dataKey="pob" fill={SERIES[6]} />
        <XAxis />
        <YAxis formatValue={inr} />
        <ChartTooltip
          rows={(point) => [{ color: SERIES[6], label: 'POB', value: inr(Number(point.pob ?? 0)) }]}
        />
      </ScatterChart>
    </ChartFrame>
  );
}
