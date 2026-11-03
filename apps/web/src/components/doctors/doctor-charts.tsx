'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { axisProps, CHART, ChartFrame, ChartTooltip } from '@/components/charts/chart';
import { useReducedMotion } from '@/lib/use-reduced-motion';

export function VisitsChart({ monthly }: { monthly: { name: string; visits: number }[] }) {
  const reduced = useReducedMotion();
  return (
    <ChartFrame height={170} label="Visits per month">
      <BarChart data={monthly} margin={{ top: 12, right: 12, left: -24, bottom: 0 }} barSize={32}>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} />
        <ChartTooltip />
        <Bar
          dataKey="visits"
          name="Visits"
          fill={CHART.primary}
          radius={[3, 3, 0, 0]}
          isAnimationActive={!reduced}
          animationDuration={500}
        />
      </BarChart>
    </ChartFrame>
  );
}
