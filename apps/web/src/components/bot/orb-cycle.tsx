'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Orb, type OrbOptions } from '@yogesharc/thinking-orbs';

/** One step at a time. Each step is a different orb, not the whole set at once. */
const CHAIN = [
  { state: 'reasoning', variant: 'twins', label: 'Reading the question' },
  { state: 'searching', variant: 'lighthouse', label: 'Checking who you can see' },
  { state: 'working', variant: 'gyro', label: 'Looking up the figures' },
  { state: 'searching', variant: 'default', label: 'Opening this month' },
  { state: 'compacting', variant: 'fuse', label: 'Putting the table together' },
  { state: 'reasoning', variant: 'default', label: 'Writing the answer' },
] as const satisfies readonly (OrbOptions & { label: string })[];

const STEP_MS = 420;

export function ThinkingChain({ active }: { active: boolean }) {
  const [shown, setShown] = useState(1);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      setShown((n) => Math.min(CHAIN.length, n + 1));
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [active]);

  return (
    <ol className="flex flex-col gap-1.5 py-1">
      {CHAIN.slice(0, shown).map((step, index) => {
        const current = active && index === shown - 1;
        return (
          <motion.li
            key={step.label}
            className="flex items-center gap-2.5"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <Orb {...step} size={18} label={step.label} className="text-primary shrink-0" />
            <span className={current ? 'text-foreground text-sm' : 'text-muted-foreground text-sm'}>
              {step.label}
            </span>
          </motion.li>
        );
      })}
    </ol>
  );
}
