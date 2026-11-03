'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { axisProps, CHART, ChartFrame, ChartTooltip } from '@/components/charts/chart';
import { useReducedMotion } from '@/lib/use-reduced-motion';

export function TeamCoverageChart({
  chart,
  listLabel,
}: {
  chart: { name: string; coverage: number | null }[];
  listLabel: string;
}) {
  const reduced = useReducedMotion();
  return (
    <ChartFrame height={Math.max(220, chart.length * 28 + 40)} label={`Coverage by ${listLabel}`}>
      <BarChart
        layout="vertical"
        data={chart}
        margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
        barSize={14}
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
        <Bar
          dataKey="coverage"
          name="Coverage"
          fill={CHART.primary}
          radius={[0, 3, 3, 0]}
          isAnimationActive={!reduced}
          animationDuration={500}
        />
      </BarChart>
    </ChartFrame>
  );
}
