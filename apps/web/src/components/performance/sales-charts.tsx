'use client';

import { useEffect, useRef } from 'react';
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

const COLUMNS = 28;
const STEP = 1 / 120;
const SPREAD = 2600;
const RESTORE = 18;
const SURFACE_DAMPING = 2.2;
const MAX_WAVE = 8;
const RIM = 3;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function surfacePolygon(
  heights: Float64Array,
  levelY: number,
  width: number,
  height: number,
  lift: number,
) {
  let points = '';
  for (let i = 0; i < COLUMNS; i++) {
    const x = (i / (COLUMNS - 1)) * width;
    const y = clamp(levelY + (heights[i] ?? 0) - lift, -40, height + 40);
    points += `${x.toFixed(1)}px ${y.toFixed(1)}px,`;
  }
  return `polygon(${points}${width}px ${height + 40}px,0px ${height + 40}px)`;
}

function useLiquidClip(root: React.RefObject<HTMLElement | null>) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    if (reduced) {
      node.querySelectorAll<HTMLElement>('[data-liquid]').forEach((el) => {
        const fill = Number(el.dataset.fill ?? 100);
        const top = 100 - fill;
        el.style.clipPath = `polygon(0% ${top}%,100% ${top}%,100% 100%,0% 100%)`;
      });
      return;
    }
    const heights = new Float64Array(COLUMNS);
    const speeds = new Float64Array(COLUMNS);
    let raf = 0;
    let last = 0;
    let carry = 0;
    let time = 0;
    const tick = (now: number) => {
      const elapsed = last ? Math.min((now - last) / 1000, 0.05) : STEP;
      last = now;
      carry += elapsed;
      while (carry >= STEP) {
        for (let i = 0; i < COLUMNS; i++) {
          const left = heights[i > 0 ? i - 1 : i] ?? 0;
          const right = heights[i < COLUMNS - 1 ? i + 1 : i] ?? 0;
          const accel =
            (left + right - 2 * (heights[i] ?? 0)) * SPREAD -
            (heights[i] ?? 0) * RESTORE -
            (speeds[i] ?? 0) * SURFACE_DAMPING;
          speeds[i] = (speeds[i] ?? 0) + accel * STEP + Math.sin(time * 0.7 + i * 0.45) * 3.2;
        }
        for (let i = 0; i < COLUMNS; i++) {
          heights[i] = clamp((heights[i] ?? 0) + (speeds[i] ?? 0) * STEP, -MAX_WAVE, MAX_WAVE);
        }
        time += STEP;
        carry -= STEP;
      }
      node.querySelectorAll<HTMLElement>('[data-liquid]').forEach((el) => {
        const fill = Number(el.dataset.fill ?? 100);
        const width = el.clientWidth;
        const height = el.clientHeight;
        if (!width || !height) return;
        const levelY = height * (1 - fill / 100);
        el.style.clipPath = surfacePolygon(heights, levelY, width, height, 0);
        const rim = el.nextElementSibling as HTMLElement | null;
        if (rim?.dataset.rim != null) {
          rim.style.clipPath = surfacePolygon(heights, levelY, width, height, RIM);
        }
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, root]);
}

const PLOT = 220;
const HEAD = 72;

function LiquidBar({
  actual,
  target,
  max,
  color,
}: {
  actual: number;
  target: number;
  max: number;
  color: string;
}) {
  const cap = Math.max(actual, target);
  const track = max > 0 ? (cap / max) * PLOT : 0;
  const fill = cap > 0 ? (actual / cap) * 100 : 0;
  const pct = target > 0 ? Math.round((actual / target) * 100) : null;
  if (actual <= 0 && target <= 0) return <div className="w-8" style={{ height: PLOT }} />;
  return (
    <div className="flex w-8 flex-col justify-end" style={{ height: PLOT }}>
      <div
        className="relative w-full overflow-hidden rounded-t-md bg-muted/40"
        style={{ height: track }}
      >
        <div
          data-liquid
          data-fill={fill}
          className="absolute inset-0"
          style={{ background: color }}
        />
        <div data-rim className="pointer-events-none absolute inset-0 bg-white/35" />
        {pct != null && track > 36 && (
          <span className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90 text-[11px] font-semibold whitespace-nowrap text-white">
            {pct}%
          </span>
        )}
      </div>
    </div>
  );
}

function Column({
  item,
  max,
  onOpen,
}: {
  item: LiquidItem;
  max: number;
  onOpen?: (id: string) => void;
}) {
  const name = (
    <span className="absolute top-1 left-1/2 origin-top-left rotate-[40deg] whitespace-nowrap text-[11px] font-medium">
      {item.name}
    </span>
  );
  return (
    <div className="flex w-36 shrink-0 flex-col items-center">
      <div className="flex w-full items-end justify-center gap-1.5" style={{ height: HEAD }}>
        <span className="relative h-full w-8">
          <span className="absolute bottom-0 left-1/2 origin-bottom-left -rotate-[40deg] whitespace-nowrap text-[11px] font-semibold tabular-nums text-[var(--color-chart-1)]">
            {item.primaryTarget > 0 ? lakh(item.primaryTarget) : ''}
          </span>
        </span>
        <span className="relative h-full w-8">
          <span className="absolute bottom-0 left-1/2 origin-bottom-left -rotate-[40deg] whitespace-nowrap text-[11px] font-semibold tabular-nums text-[var(--color-chart-2)]">
            {item.secondaryTarget > 0 ? lakh(item.secondaryTarget) : ''}
          </span>
        </span>
      </div>
      <div className="flex items-end justify-center gap-1.5" style={{ height: PLOT }}>
        <LiquidBar
          actual={item.primary}
          target={item.primaryTarget}
          max={max}
          color={CHART.series[0]!}
        />
        <LiquidBar
          actual={item.secondary}
          target={item.secondaryTarget}
          max={max}
          color={CHART.series[1]!}
        />
      </div>
      {onOpen ? (
        <button
          type="button"
          className="relative h-24 w-full overflow-hidden"
          onClick={() => onOpen(item.id)}
        >
          {name}
        </button>
      ) : (
        <div className="relative h-24 w-full overflow-hidden">{name}</div>
      )}
    </div>
  );
}

/** Rupee axis on the left. Each place is one column, so its name and targets share the bars' center. */
export function LiquidColumns({
  items,
  onOpen,
}: {
  items: LiquidItem[];
  onOpen?: (id: string) => void;
}) {
  const root = useRef<HTMLElement>(null);
  useLiquidClip(root);
  const max = Math.max(
    1,
    ...items.flatMap((item) => [
      item.primary,
      item.secondary,
      item.primaryTarget,
      item.secondaryTarget,
    ]),
  );
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((step) => max * step);
  return (
    <figure ref={root} className="flex">
      <div
        className="relative w-16 shrink-0 text-[11px] tabular-nums text-muted-foreground"
        style={{ height: PLOT, marginTop: HEAD }}
      >
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute right-2 -translate-y-1/2"
            style={{ top: `${(1 - tick / max) * 100}%` }}
          >
            {inr(tick)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="relative flex w-max border-l border-border">
          <div
            className="pointer-events-none absolute right-0 left-0 border-b border-border"
            style={{ top: HEAD, height: PLOT }}
          >
            {ticks.slice(0, -1).map((tick) => (
              <div
                key={tick}
                className="absolute right-0 left-0 border-t border-border/70"
                style={{ bottom: `${(tick / max) * 100}%` }}
              />
            ))}
          </div>
          {items.map((item) => (
            <Column key={item.id} item={item} max={max} onOpen={onOpen} />
          ))}
        </div>
      </div>
    </figure>
  );
}
