'use client';

import { Bar } from '@/components/charts/bar';
import { BarChart } from '@/components/charts/bar-chart';
import { BarXAxis } from '@/components/charts/bar-x-axis';
import { ChartFrame, SERIES } from '@/components/charts/chart';
import { YAxis } from '@/components/charts/y-axis';
import { ChartTooltip } from '@/components/charts/tooltip/chart-tooltip';
import { useReducedMotion } from '@/lib/use-reduced-motion';

export function TeamCoverageChart({
  chart,
  label,
  percent,
}: {
  chart: { name: string; value: number }[];
  label: string;
  percent: boolean;
}) {
  const reduced = useReducedMotion();
  const wide = Math.max(chart.length * 64, 320);
  return (
    <div className="min-w-0 overflow-x-auto">
      <div style={{ width: chart.length > 8 ? wide : '100%', minWidth: '100%' }}>
        <ChartFrame
          height={420}
          label={label}
          rows={chart.map((row) => ({
            name: row.name,
            cells: [{ label, value: percent ? `${row.value}%` : String(row.value) }],
          }))}
        >
          <BarChart
            data={chart}
            xDataKey="name"
            aspectRatio=""
            className="h-full"
            animationDuration={reduced ? 0 : 700}
            margin={{ top: 12, right: 12, bottom: 120, left: 40 }}
          >
            <Bar
              dataKey="value"
              fill={SERIES[2]}
              showValue
              valueLabelFormatter={(value) => (percent ? `${Math.round(value)}%` : String(value))}
              valueLabelOrientation="vertical"
            />
            <BarXAxis slant showAllLabels maxLabels={chart.length} />
            <YAxis formatValue={(value) => (percent ? `${Math.round(value)}%` : String(value))} />
            <ChartTooltip
              showDatePill={false}
              rows={(point) => [
                {
                  color: SERIES[2],
                  label,
                  value: percent ? `${Number(point.value ?? 0)}%` : Number(point.value ?? 0),
                },
              ]}
            />
          </BarChart>
        </ChartFrame>
      </div>
    </div>
  );
}
