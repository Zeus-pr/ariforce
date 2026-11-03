'use client';

import { Bar, CartesianGrid, ComposedChart, Legend, Line, XAxis, YAxis } from 'recharts';
import { inr } from './perf-ui';
import { axisProps, CHART, ChartFrame, ChartTooltip } from '@/components/charts/chart';
import { useReducedMotion } from '@/lib/use-reduced-motion';

const lakh = (v: number) => `₹${(v / 1e5).toFixed(1)}L`;

export function SalesTrendChart({
  trend,
}: {
  trend: {
    name: string;
    primary: number | null;
    secondary: number | null;
    target: number | null;
  }[];
}) {
  const reduced = useReducedMotion();
  return (
    <ChartFrame height={240} label="Sales against target, six months">
      <ComposedChart data={trend} margin={{ top: 12, right: 12, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis tickFormatter={lakh} {...axisProps} width={56} />
        <ChartTooltip format={inr} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar
          dataKey="primary"
          name="Primary"
          fill={CHART.series[0]}
          radius={[3, 3, 0, 0]}
          isAnimationActive={!reduced}
        />
        <Bar
          dataKey="secondary"
          name="Secondary"
          fill={CHART.series[1]}
          radius={[3, 3, 0, 0]}
          isAnimationActive={!reduced}
        />
        <Line
          dataKey="target"
          name="Primary target"
          stroke={CHART.muted}
          strokeDasharray="4 3"
          dot={false}
          isAnimationActive={!reduced}
        />
      </ComposedChart>
    </ChartFrame>
  );
}
