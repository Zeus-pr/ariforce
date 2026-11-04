'use client';

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from 'recharts';
import { axisProps, CHART, ChartFrame, ChartTooltip } from '@/components/charts/chart';
import { useReducedMotion } from '@/lib/use-reduced-motion';

export function CoverageTrendChart({
  trend,
}: {
  trend: { name: string; coverage: number | null; frequency: number | null }[];
}) {
  const reduced = useReducedMotion();
  return (
    <ChartFrame height={220} label="Coverage over six months">
      <LineChart data={trend} margin={{ top: 12, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis domain={[0, 100]} unit="%" {...axisProps} />
        <ChartTooltip format={(v) => `${v}%`} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
        <Line
          dataKey="coverage"
          name="Coverage"
          stroke={CHART.series[0]}
          strokeWidth={2}
          dot={false}
          isAnimationActive={!reduced}
        />
        <Line
          dataKey="frequency"
          name="Frequency compliance"
          stroke={CHART.series[1]}
          strokeWidth={2}
          dot={false}
          isAnimationActive={!reduced}
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
  return (
    <ChartFrame height={Math.max(220, bars.length * 44 + 56)} label={label}>
      <BarChart
        layout="vertical"
        data={bars}
        margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
        barGap={2}
        barSize={12}
      >
        <CartesianGrid horizontal={false} stroke={CHART.grid} />
        <XAxis type="number" domain={[0, 100]} unit="%" {...axisProps} />
        <YAxis
          type="category"
          dataKey="name"
          width={96}
          interval={0}
          {...axisProps}
          tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
        />
        <ChartTooltip format={(v) => `${v}%`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar
          dataKey="coverage"
          name="Coverage"
          fill={CHART.series[0]}
          radius={[0, 3, 3, 0]}
          isAnimationActive={!reduced}
        />
        <Bar
          dataKey="frequency"
          name="Frequency compliance"
          fill={CHART.series[1]}
          radius={[0, 3, 3, 0]}
          isAnimationActive={!reduced}
        />
      </BarChart>
    </ChartFrame>
  );
}
