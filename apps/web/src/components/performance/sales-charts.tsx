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
  height = 240,
}: {
  years: { year: string; primary: number; secondary: number }[];
  label?: string;
  height?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <ChartFrame height={height} label={label}>
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

export type LiquidItem = {
  id: string;
  name: string;
  primary: number;
  secondary: number;
  primaryTarget: number;
  secondaryTarget: number;
};

function fillOf(actual: number, target: number) {
  if (target <= 0) return actual > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, (actual / target) * 100));
}

function Tank({ actual, target, color }: { actual: number; target: number; color: string }) {
  const pct = fillOf(actual, target);
  return (
    <div className="flex w-9 flex-col items-center gap-1">
      <span className="text-[10px] font-medium tabular-nums">{actual ? inr(actual) : ''}</span>
      <div className="relative h-36 w-full overflow-hidden rounded-md border bg-muted/40">
        <div
          className="absolute inset-x-0 bottom-0"
          style={{ height: `${pct}%`, background: color }}
        >
          <svg
            className="af-liquid absolute -top-2 left-0 h-3 w-[200%] text-background/40"
            viewBox="0 0 120 12"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path fill="currentColor" d="M0 7 Q15 0 30 7 T60 7 T90 7 T120 7 V12 H0 Z" />
          </svg>
        </div>
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {target > 0 ? `${Math.round((actual / target) * 100)}%` : ''}
      </span>
    </div>
  );
}

/** Columns across the page. Each pair is a target tank filled to the actual. */
export function LiquidColumns({
  items,
  onOpen,
}: {
  items: LiquidItem[];
  onOpen?: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="flex w-max min-w-full gap-4 px-1 pb-1">
        {items.map((item) => (
          <div key={item.id} className="flex w-24 flex-col items-center gap-2">
            <div className="flex gap-2">
              <Tank actual={item.primary} target={item.primaryTarget} color={CHART.series[0]!} />
              <Tank
                actual={item.secondary}
                target={item.secondaryTarget}
                color={CHART.series[1]!}
              />
            </div>
            {onOpen ? (
              <button
                type="button"
                className="h-16 text-left text-[11px] leading-tight font-medium underline-offset-2 hover:underline"
                onClick={() => onOpen(item.id)}
              >
                <span className="inline-block origin-top-left -rotate-45">{item.name}</span>
              </button>
            ) : (
              <span className="inline-block h-16 origin-top-left -rotate-45 text-[11px] leading-tight font-medium">
                {item.name}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
