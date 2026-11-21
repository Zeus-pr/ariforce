'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  XAxis,
  YAxis,
} from 'recharts';
import { inr } from './perf-ui';
import { axisProps, CHART, ChartFrame, ChartTooltip } from '@/components/charts/chart';
import { useReducedMotion } from '@/lib/use-reduced-motion';

const lakh = (v: number) => `₹${(v / 1e5).toFixed(1)}L`;

export function SalesTrendChart({
  trend,
  onMonth,
}: {
  trend: {
    name: string;
    month?: string;
    primary: number | null;
    secondary: number | null;
    target: number | null;
  }[];
  onMonth?: (month: string) => void;
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
          cursor={onMonth ? 'pointer' : undefined}
          onClick={(point) => {
            const month = (point as { month?: string }).month;
            if (month) onMonth?.(month);
          }}
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

const rupeeLabel = (value: unknown) => (Number(value) ? inr(Number(value)) : '');

export function YearCompareChart({
  years,
  label = 'This year and last year',
}: {
  years: { year: string; primary: number; secondary: number }[];
  label?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <ChartFrame height={240} label={label}>
      <BarChart data={years} margin={{ top: 28, right: 8, left: 0, bottom: 0 }} barGap={4}>
        <CartesianGrid vertical={false} stroke={CHART.grid} />
        <XAxis dataKey="year" {...axisProps} />
        <YAxis hide />
        <ChartTooltip format={inr} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar
          dataKey="primary"
          name="Primary"
          fill={CHART.series[0]}
          radius={[4, 4, 0, 0]}
          isAnimationActive={!reduced}
        >
          <LabelList
            dataKey="primary"
            position="top"
            formatter={rupeeLabel}
            className="fill-foreground text-[10px]"
          />
        </Bar>
        <Bar
          dataKey="secondary"
          name="Secondary"
          fill={CHART.series[1]}
          radius={[4, 4, 0, 0]}
          isAnimationActive={!reduced}
        >
          <LabelList
            dataKey="secondary"
            position="top"
            formatter={rupeeLabel}
            className="fill-foreground text-[10px]"
          />
        </Bar>
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
  const height = Math.max(180, places.length * 64 + 36);
  return (
    <ChartFrame height={height} label={label}>
      <BarChart
        layout="vertical"
        data={places}
        margin={{ top: 8, right: 88, left: 8, bottom: 0 }}
        barGap={2}
      >
        <CartesianGrid horizontal={false} stroke={CHART.grid} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={128}
          tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
          {...axisProps}
        />
        <ChartTooltip format={inr} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar
          dataKey="primary"
          name="Primary"
          fill={CHART.series[0]}
          radius={[0, 4, 4, 0]}
          isAnimationActive={!reduced}
          cursor={onOpen ? 'pointer' : undefined}
          onClick={(point) => {
            const id = (point as { id?: string }).id;
            if (id) onOpen?.(id);
          }}
        >
          <LabelList
            dataKey="primary"
            position="right"
            formatter={rupeeLabel}
            className="fill-foreground text-[11px]"
          />
        </Bar>
        <Bar
          dataKey="secondary"
          name="Secondary"
          fill={CHART.series[1]}
          radius={[0, 4, 4, 0]}
          isAnimationActive={!reduced}
          cursor={onOpen ? 'pointer' : undefined}
          onClick={(point) => {
            const id = (point as { id?: string }).id;
            if (id) onOpen?.(id);
          }}
        >
          <LabelList
            dataKey="secondary"
            position="right"
            formatter={rupeeLabel}
            className="fill-foreground text-[11px]"
          />
        </Bar>
      </BarChart>
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
  const wide = Math.max(places.length * 56, 320);
  return (
    <div className="overflow-x-auto">
      <div style={{ width: places.length > 10 ? wide : '100%', minWidth: '100%' }}>
        <ChartFrame height={300} label={label}>
          <BarChart data={places} margin={{ top: 20, right: 8, left: 0, bottom: 4 }} barGap={2}>
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis
              dataKey="name"
              interval={0}
              angle={-40}
              textAnchor="end"
              height={88}
              tick={{ fontSize: 11 }}
              {...axisProps}
            />
            <YAxis tickFormatter={lakh} width={52} {...axisProps} />
            <ChartTooltip format={inr} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar
              dataKey="primary"
              name="Primary"
              fill={CHART.series[0]}
              radius={[3, 3, 0, 0]}
              isAnimationActive={!reduced}
            >
              <LabelList
                dataKey="primary"
                position="top"
                formatter={rupeeLabel}
                className="fill-foreground text-[10px]"
              />
            </Bar>
            <Bar
              dataKey="secondary"
              name="Secondary"
              fill={CHART.series[1]}
              radius={[3, 3, 0, 0]}
              isAnimationActive={!reduced}
            >
              <LabelList
                dataKey="secondary"
                position="top"
                formatter={rupeeLabel}
                className="fill-foreground text-[10px]"
              />
            </Bar>
          </BarChart>
        </ChartFrame>
      </div>
    </div>
  );
}
