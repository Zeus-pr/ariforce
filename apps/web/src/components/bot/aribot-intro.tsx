'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { BotAvatar } from 'bot-avatars';
import { Button } from '@ariforce/ui/components/button';
import { DotPattern } from '@/components/ui/dot-pattern';

const BOT_COLOR = '#14b8a6';

const FEATURES = [
  {
    title: 'Your line, or the company',
    body: 'Managers see their own team. Director, Distribution Head, and System Admin see the whole company.',
  },
  {
    title: 'Figures from AriForce',
    body: 'Coverage, calls, tour plans, and sales come from live AriForce data — not invented numbers.',
  },
  {
    title: 'Peers stay closed',
    body: 'An Area Business Manager cannot open another Area Business Manager’s numbers, or a company total.',
  },
];

export function AribotIntro({ userId, onOpen }: { userId: string; onOpen: () => void }) {
  const key = `af:aribot-intro:${userId}`;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(key)) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, [key]);

  const dismiss = (thenOpen: boolean) => {
    try {
      localStorage.setItem(key, '1');
    } catch {
      // Private mode: the introduction simply will not persist.
    }
    setOpen(false);
    if (thenOpen) onOpen();
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <button
            type="button"
            aria-label="Close introduction"
            className="absolute inset-0 bg-black/40"
            onClick={() => dismiss(false)}
          />
          <motion.div
            role="dialog"
            aria-labelledby="aribot-intro-title"
            className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#14b8a6]/20 bg-[#f4faf9] text-foreground shadow-[0_24px_64px_rgba(15,23,42,0.18)]"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <DotPattern
              width={18}
              height={18}
              cr={1.15}
              className="text-[#14b8a6]/35 [mask-image:radial-gradient(ellipse_at_top,white,transparent_85%)]"
            />
            <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-6 pt-7 pb-4">
              <div className="relative w-fit">
                <div
                  aria-hidden
                  className="absolute -inset-4 rounded-full bg-[#14b8a6]/20 blur-2xl"
                />
                <BotAvatar
                  type="droid"
                  state="default"
                  size={52}
                  color={BOT_COLOR}
                  interactive={false}
                  aria-hidden
                  className="pointer-events-none relative"
                />
              </div>
              <p className="mt-5 text-[11px] font-medium tracking-[0.2em] text-[#0f766e] uppercase">
                New in AriForce
              </p>
              <h2
                id="aribot-intro-title"
                className="mt-2 text-2xl font-semibold tracking-tight text-[#134e4a]"
              >
                Meet ARIBOT
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[#0f766e]/80">
                Ask a business question in plain language. The answer stays inside what you are
                already allowed to see.
              </p>
              <ul className="mt-5 flex flex-col gap-2.5">
                {FEATURES.map((feature) => (
                  <li
                    key={feature.title}
                    className="rounded-xl border border-[#14b8a6]/12 bg-white/80 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-sm"
                  >
                    <p className="text-sm font-medium text-[#134e4a]">{feature.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-[#0f766e]/75">{feature.body}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative z-10 flex shrink-0 items-center justify-end gap-2 border-t border-[#14b8a6]/15 bg-white/70 px-6 py-4 backdrop-blur-sm">
              <Button
                type="button"
                variant="ghost"
                className="text-[#0f766e] hover:bg-[#14b8a6]/10 hover:text-[#0f766e]"
                onClick={() => dismiss(false)}
              >
                Not now
              </Button>
              <Button
                type="button"
                className="bg-[#14b8a6] text-white hover:bg-[#0f9f8f]"
                onClick={() => dismiss(true)}
              >
                Open ARIBOT
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
