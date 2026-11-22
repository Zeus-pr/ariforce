'use client';

import { useEffect, useState } from 'react';
import { Orb, type OrbOptions } from '@yogesharc/thinking-orbs';

/** Every state and variant the library ships. */
const LOOKS = [
  { state: 'idle', variant: 'default' },
  { state: 'idle', variant: 'blink' },
  { state: 'working', variant: 'default' },
  { state: 'working', variant: 'gyro' },
  { state: 'reasoning', variant: 'default' },
  { state: 'reasoning', variant: 'twins' },
  { state: 'searching', variant: 'default' },
  { state: 'searching', variant: 'lighthouse' },
  { state: 'background', variant: 'default' },
  { state: 'background', variant: 'spiral' },
  { state: 'retrying', variant: 'default' },
  { state: 'retrying', variant: 'surge' },
  { state: 'compacting', variant: 'default' },
  { state: 'compacting', variant: 'squeeze' },
  { state: 'compacting', variant: 'fuse' },
  { state: 'waiting', variant: 'default' },
  { state: 'using', variant: 'default' },
  { state: 'using', variant: 'tap' },
  { state: 'using', variant: 'scroll' },
  { state: 'using', variant: 'type' },
  { state: 'using', variant: 'zoom' },
  { state: 'using', variant: 'snap' },
  { state: 'using', variant: 'record' },
] as const satisfies readonly OrbOptions[];

export function CyclingOrb({ active, size = 16 }: { active: boolean; size?: number }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setIndex((n) => (n + 1) % LOOKS.length), 700);
    return () => window.clearInterval(id);
  }, [active]);
  const look = active ? LOOKS[index] : LOOKS[3];
  return <Orb {...look} size={size} label={look.state} className="text-primary shrink-0" />;
}

export function OrbSet({ size = 18 }: { size?: number }) {
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-2 py-2">
      {LOOKS.map((look) => (
        <Orb
          key={`${look.state}-${look.variant}`}
          {...look}
          size={size}
          label={`${look.state} ${look.variant}`}
          className="text-primary"
        />
      ))}
    </div>
  );
}
