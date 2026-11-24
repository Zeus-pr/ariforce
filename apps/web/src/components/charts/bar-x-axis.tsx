'use client';

import { memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useChart, useChartPortalContainer, useChartStable } from './chart-context';
import {
  type ChartLabelCount,
  resolveResponsiveChartLabelCount,
} from './responsive-chart-label-count';

export interface BarXAxisProps {
  /** Width of the date ticker box for fade calculation. Default: 50 */
  tickerHalfWidth?: number;
  /** Whether to show all labels or skip some for dense data. Default: false */
  showAllLabels?: boolean;
  /** Maximum number of labels to show. Supports responsive breakpoints. */
  maxLabels?: ChartLabelCount;
  /** Tilt each name up from the tick, so neighbours do not cover each other. */
  slant?: boolean;
}

interface BarXAxisLabelProps {
  label: string;
  x: number;
  crosshairX: number | null;
  isHovering: boolean;
  tickerHalfWidth: number;
  slant: boolean;
}

function BarXAxisLabel({
  label,
  x,
  crosshairX,
  isHovering,
  tickerHalfWidth,
  slant,
}: BarXAxisLabelProps) {
  const fadeBuffer = 20;
  const fadeRadius = tickerHalfWidth + fadeBuffer;

  let opacity = 1;
  if (isHovering && crosshairX !== null) {
    const distance = Math.abs(x - crosshairX);
    if (distance < tickerHalfWidth) {
      opacity = 0;
    } else if (distance < fadeRadius) {
      opacity = (distance - tickerHalfWidth) / fadeBuffer;
    }
  }

  // Zero-width container approach for perfect centering
  if (!slant) {
    return (
      <div
        className="absolute whitespace-nowrap text-chart-label text-xs"
        style={{
          left: x,
          bottom: 12,
          opacity,
          transform: 'translateX(-50%)',
        }}
      >
        {label}
      </div>
    );
  }

  return (
    <div className="absolute" style={{ left: x, bottom: 96, width: 0, height: 0 }}>
      <div
        className="absolute whitespace-nowrap text-chart-label text-xs"
        style={{
          right: 0,
          bottom: 0,
          opacity,
          transform: 'rotate(-40deg)',
          transformOrigin: 'right bottom',
        }}
      >
        {label}
      </div>
    </div>
  );
}

export function BarXAxis(props: BarXAxisProps) {
  const { containerRef, barScale } = useChartStable();
  const container = useChartPortalContainer(containerRef);
  if (!container) {
    return null;
  }

  if (!barScale) {
    return null;
  }

  return <BarXAxisInner {...props} container={container} />;
}

const BarXAxisInner = memo(function BarXAxisInner({
  tickerHalfWidth = 50,
  showAllLabels = false,
  maxLabels = 12,
  slant = false,
  container,
}: BarXAxisProps & { container: HTMLDivElement }) {
  const { margin, tooltipData, barScale, bandWidth, barXAccessor, data, width } = useChart();

  const resolvedMaxLabels = useMemo(
    () => resolveResponsiveChartLabelCount(maxLabels, width, 12),
    [maxLabels, width],
  );

  // Generate labels for each bar
  const labelsToShow = useMemo(() => {
    if (!(barScale && bandWidth && barXAccessor)) {
      return [];
    }

    const allLabels = data.map((d) => {
      const label = barXAccessor(d);
      const bandX = barScale(label) ?? 0;
      // Center the label under the bar group
      const x = bandX + bandWidth / 2 + margin.left;
      return { label, x };
    });

    // If showAllLabels is true or we have fewer than maxLabels, show all
    if (showAllLabels || allLabels.length <= resolvedMaxLabels) {
      return allLabels;
    }

    // Otherwise, skip some labels to avoid crowding
    const step = Math.ceil(allLabels.length / Math.max(1, resolvedMaxLabels));
    return allLabels.filter((_, i) => i % step === 0);
  }, [barScale, bandWidth, barXAccessor, data, margin.left, showAllLabels, resolvedMaxLabels]);

  const isHovering = tooltipData !== null;
  const crosshairX = tooltipData ? tooltipData.x + margin.left : null;

  return createPortal(
    <div className="pointer-events-none absolute inset-0">
      {labelsToShow.map((item) => (
        <BarXAxisLabel
          crosshairX={crosshairX}
          isHovering={isHovering}
          key={`${item.label}-${item.x}`}
          label={item.label}
          slant={slant}
          tickerHalfWidth={tickerHalfWidth}
          x={item.x}
        />
      ))}
    </div>,
    container,
  );
});

BarXAxis.displayName = 'BarXAxis';

export default BarXAxis;
