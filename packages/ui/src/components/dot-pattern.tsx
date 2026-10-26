// Adapted from Magic UI "Dot Pattern" (MIT, https://magicui.design/docs/components/dot-pattern).
// Changes: static SVG <pattern> (one element instead of one <circle> per dot), no `motion`,
// no resize listener; colour comes from currentColor so it follows tokens.
import { useId, type SVGProps } from 'react';
import { cn } from '@ariforce/ui/lib/utils';

type Props = SVGProps<SVGSVGElement> & { gap?: number; radius?: number };

export function DotPattern({ gap = 16, radius = 1, className, ...props }: Props) {
  const id = useId();
  return (
    <svg aria-hidden="true" className={cn('pointer-events-none absolute inset-0 size-full', className)} {...props}>
      <defs>
        <pattern id={id} width={gap} height={gap} patternUnits="userSpaceOnUse">
          <circle cx={radius} cy={radius} r={radius} fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
