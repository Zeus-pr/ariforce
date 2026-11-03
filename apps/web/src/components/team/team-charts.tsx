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
    <ChartFrame height={220} label={`Coverage by ${listLabel}`}>
      <BarChart data={chart} margin={{ top: 12, right: 12, left: -12, bottom: 0 }} barSize={28}>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis
          dataKey="name"
          {...axisProps}
          interval={0}
          tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
        />
        <YAxis domain={[0, 100]} unit="%" {...axisProps} />
        <ChartTooltip format={(v) => `${v}%`} />
        <Bar
          dataKey="coverage"
          name="Coverage"
          fill={CHART.primary}
          radius={[3, 3, 0, 0]}
          isAnimationActive={!reduced}
          animationDuration={500}
        />
      </BarChart>
    </ChartFrame>
  );
}
