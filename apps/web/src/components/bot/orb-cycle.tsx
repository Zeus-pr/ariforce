'use client';

import { useEffect, useState } from 'react';
import { BotAvatar } from 'bot-avatars';

/** One status at a time — bot + sentence, aligned like Claude / ChatGPT. */
const STEPS = [
  'Reading your question',
  'Checking what you can see',
  'Looking up the figures',
  'Writing the answer',
] as const;

const STEP_MS = 1400;
const BOT_COLOR = '#14b8a6';

export function ThinkingStatus({ active }: { active: boolean }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!active) {
      setStep(0);
      return;
    }
    const id = window.setInterval(() => {
      setStep((n) => (n + 1) % STEPS.length);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active) return null;

  return (
    <div className="mb-3 flex items-center gap-2.5 px-2" aria-live="polite" aria-busy="true">
      <BotAvatar
        type="droid"
        state="working"
        size={22}
        color={BOT_COLOR}
        interactive={false}
        aria-hidden
        className="pointer-events-none shrink-0"
      />
      <span className="shimmer motion-reduce:animate-none text-muted-foreground inline-flex h-[22px] items-center text-sm leading-none">
        {STEPS[step]}
      </span>
    </div>
  );
}
