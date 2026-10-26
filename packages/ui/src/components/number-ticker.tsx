'use client';

// Adapted from Magic UI "Number Ticker" (MIT, https://magicui.design/docs/components/number-ticker).
// Changes: no `motion` dependency (rAF + ease-out), en-IN formatting, respects prefers-reduced-motion,
// renders the final value on the server so there is no layout shift and no flash of "0".
import { useEffect, useRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '@ariforce/ui/lib/utils';

type Props = ComponentPropsWithoutRef<'span'> & {
  value: number;
  decimalPlaces?: number;
  durationMs?: number;
  suffix?: string;
};

export function NumberTicker({ value, decimalPlaces = 0, durationMs = 900, suffix = '', className, ...props }: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const fmt = new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    });
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 4);
      el.textContent = fmt.format(value * eased) + suffix;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, decimalPlaces, durationMs, suffix]);

  return (
    <span ref={ref} className={cn('inline-block tabular-nums', className)} {...props}>
      {new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      }).format(value) + suffix}
    </span>
  );
}
