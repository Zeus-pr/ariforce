'use client';

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from 'recharts';
import { axisProps, CHART, ChartFrame, ChartTooltip } from '@/components/charts/chart';
import { useReducedMotion } from '@/lib/use-reduced-motion';

const short = (s: string) => (s.length > 12 ? `${s.slice(0, 11)}…` : s);

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
    <ChartFrame height={220} label={label}>
      <BarChart data={bars} margin={{ top: 12, right: 12, left: -12, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="name" {...axisProps} interval={0} tickFormatter={short} />
        <YAxis domain={[0, 100]} unit="%" {...axisProps} />
        <ChartTooltip format={(v) => `${v}%`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar
          dataKey="coverage"
          name="Coverage"
          fill={CHART.series[0]}
          radius={[3, 3, 0, 0]}
          isAnimationActive={!reduced}
        />
        <Bar
          dataKey="frequency"
          name="Frequency compliance"
          fill={CHART.series[1]}
          radius={[3, 3, 0, 0]}
          isAnimationActive={!reduced}
        />
      </BarChart>
    </ChartFrame>
  );
}

export function CategoryChart({ cats }: { cats: { category: string; coverage: number }[] }) {
  const reduced = useReducedMotion();
  return (
    <ChartFrame height={220} label="Coverage by doctor category">
      <BarChart
        data={cats ?? []}
        margin={{ top: 12, right: 12, left: -12, bottom: 0 }}
        barSize={32}
      >
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="category" {...axisProps} />
        <YAxis domain={[0, 100]} unit="%" {...axisProps} />
        <ChartTooltip format={(v) => `${v}%`} />
        <Bar
          dataKey="coverage"
          name="Coverage"
          fill={CHART.series[0]}
          radius={[3, 3, 0, 0]}
          isAnimationActive={!reduced}
        />
      </BarChart>
    </ChartFrame>
  );
}
