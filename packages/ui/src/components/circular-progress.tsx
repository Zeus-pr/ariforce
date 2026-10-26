// Adapted from Magic UI "Animated Circular Progress Bar" (MIT,
// https://magicui.design/docs/components/animated-circular-progress-bar).
// Changes: token colours via currentColor/classes instead of colour props, smaller sizes for dense
// tables, accessible progressbar role, transition only on stroke-dashoffset (no layout).
import { cn } from '@ariforce/ui/lib/utils';

type Props = {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  className?: string;
  trackClassName?: string;
  showValue?: boolean;
};

export function CircularProgress({
  value,
  max = 100,
  size = 36,
  strokeWidth = 4,
  label,
  className,
  trackClassName,
  showValue = true,
}: Props) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('relative inline-grid place-items-center text-primary', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          className={cn('stroke-muted', trackClassName)}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      {showValue && (
        <span className="absolute text-[10px] font-medium tabular-nums text-foreground">{pct}</span>
      )}
    </div>
  );
}
