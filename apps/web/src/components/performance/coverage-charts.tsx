'use client';

import { Bar } from '@/components/charts/bar';
import { BarChart } from '@/components/charts/bar-chart';
import { BarXAxis } from '@/components/charts/bar-x-axis';
import { ChartFrame, monthDate, SERIES } from '@/components/charts/chart';
import { Grid } from '@/components/charts/grid';
import { Line } from '@/components/charts/line';
import { LineChart } from '@/components/charts/line-chart';
import { RadarArea } from '@/components/charts/radar-area';
import { RadarAxis } from '@/components/charts/radar-axis';
import { RadarChart } from '@/components/charts/radar-chart';
import { RadarGrid } from '@/components/charts/radar-grid';
import { RadarLabels } from '@/components/charts/radar-labels';
import { Ring } from '@/components/charts/ring';
import { RingCenter } from '@/components/charts/ring-center';
import { RingChart } from '@/components/charts/ring-chart';
import { ChartTooltip } from '@/components/charts/tooltip/chart-tooltip';
import { XAxis } from '@/components/charts/x-axis';
import { YAxis } from '@/components/charts/y-axis';
import { useReducedMotion } from '@/lib/use-reduced-motion';

function pct(value: number) {
  return `${Math.round(value)}%`;
}

export function CoverageTrendChart({
  trend,
}: {
  trend: { name: string; month?: string; coverage: number | null; frequency: number | null }[];
}) {
  const reduced = useReducedMotion();
  const data = trend.map((point) => ({
    date: monthDate(point.month, point.name),
    coverage: point.coverage ?? 0,
    frequency: point.frequency ?? 0,
  }));
  return (
    <ChartFrame
      height={220}
      label="Coverage over six months"
      rows={trend.map((point) => ({
        name: point.name,
        cells: [
          { label: 'Coverage', value: point.coverage == null ? '—' : pct(point.coverage) },
          {
            label: 'Frequency compliance',
            value: point.frequency == null ? '—' : pct(point.frequency),
          },
        ],
      }))}
    >
      <LineChart
        data={data}
        xDataKey="date"
        aspectRatio=""
        className="h-full"
        animationDuration={reduced ? 0 : 800}
      >
        <Grid vertical={false} />
        <Line dataKey="coverage" stroke={SERIES[0]} fadeEdges={false} />
        <Line dataKey="frequency" stroke={SERIES[5]} fadeEdges={false} />
        <XAxis />
        <YAxis formatValue={pct} />
        <ChartTooltip
          rows={(point) => [
            { color: SERIES[0], label: 'Coverage', value: pct(Number(point.coverage ?? 0)) },
            {
              color: SERIES[5],
              label: 'Frequency compliance',
              value: pct(Number(point.frequency ?? 0)),
            },
          ]}
        />
      </LineChart>
    </ChartFrame>
  );
}

export function CoverageBarsChart({
  bars,
  label,
}: {
  bars: { name: string; coverage: number | null; frequency: number | null }[];
  label: string;
}) {
  const reduced = useReducedMotion();
  const data = bars.map((bar) => ({
    name: bar.name,
    coverage: bar.coverage ?? 0,
    frequency: bar.frequency ?? 0,
  }));
  const wide = Math.max(bars.length * 72, 320);
  return (
    <div className="min-w-0 overflow-x-auto">
      <div style={{ width: bars.length > 6 ? wide : '100%', minWidth: '100%' }}>
        <ChartFrame
          height={420}
          label={label}
          rows={bars.map((bar) => ({
            name: bar.name,
            cells: [
              { label: 'Coverage', value: bar.coverage == null ? '—' : pct(bar.coverage) },
              {
                label: 'Frequency compliance',
                value: bar.frequency == null ? '—' : pct(bar.frequency),
              },
            ],
          }))}
        >
          <BarChart
            data={data}
            xDataKey="name"
            aspectRatio=""
            className="h-full"
            animationDuration={reduced ? 0 : 700}
            margin={{ top: 12, right: 12, bottom: 120, left: 48 }}
          >
            <Bar
              dataKey="coverage"
              fill={SERIES[0]}
              showValue
              valueLabelFormatter={pct}
              valueLabelOrientation="vertical"
            />
            <Bar
              dataKey="frequency"
              fill={SERIES[5]}
              showValue
              valueLabelFormatter={pct}
              valueLabelOrientation="vertical"
            />
            <BarXAxis slant showAllLabels maxLabels={bars.length} />
            <YAxis formatValue={pct} />
            <ChartTooltip
              showDatePill={false}
              rows={(point) => [
                { color: SERIES[0], label: 'Coverage', value: pct(Number(point.coverage ?? 0)) },
                {
                  color: SERIES[5],
                  label: 'Frequency compliance',
                  value: pct(Number(point.frequency ?? 0)),
                },
              ]}
            />
          </BarChart>
        </ChartFrame>
      </div>
    </div>
  );
}

export function CoverageRings({
  coverage,
  frequency,
  missed,
}: {
  coverage: number | null;
  frequency: number | null;
  missed: number | null;
}) {
  const rings = [
    { label: 'Coverage', value: coverage ?? 0, maxValue: 100, color: SERIES[0] },
    { label: 'Frequency', value: frequency ?? 0, maxValue: 100, color: SERIES[5] },
    {
      label: 'Doctors kept',
      value: missed == null ? 0 : Math.max(0, 100 - missed),
      maxValue: 100,
      color: SERIES[2],
    },
  ];
  return (
    <ChartFrame height={240} label="Coverage, frequency, and doctors kept">
      <RingChart data={rings} size={220} className="mx-auto">
        {rings.map((ring, index) => (
          <Ring key={ring.label} index={index} />
        ))}
        <RingCenter />
      </RingChart>
    </ChartFrame>
  );
}

export function CoverageRadar({
  coverage,
  frequency,
  missed,
}: {
  coverage: number | null;
  frequency: number | null;
  missed: number | null;
}) {
  return (
    <ChartFrame height={280} label="Coverage shape this month">
      <RadarChart
        size={260}
        className="mx-auto"
        data={[
          {
            label: 'This month',
            color: SERIES[0],
            values: {
              coverage: coverage ?? 0,
              frequency: frequency ?? 0,
              kept: missed == null ? 0 : Math.max(0, 100 - missed),
            },
          },
        ]}
        metrics={[
          { key: 'coverage', label: 'Coverage' },
          { key: 'frequency', label: 'Frequency' },
          { key: 'kept', label: 'Doctors kept' },
        ]}
      >
        <RadarGrid />
        <RadarAxis />
        <RadarLabels />
        <RadarArea index={0} />
      </RadarChart>
    </ChartFrame>
  );
}
