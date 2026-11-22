'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Orb } from '@yogesharc/thinking-orbs';
import { Button } from '@ariforce/ui/components/button';

const FEATURES = [
  {
    title: 'Your line, or the company',
    body: 'Managers see their own team. Director, Distribution Head, and System Admin see the whole company.',
  },
  {
    title: 'Figures from AriForce',
    body: 'Coverage, calls, tour plans, sales, and products come back as a table. A number that was not looked up is not shown.',
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
          transition={{ duration: 0.25 }}
        >
          <button
            type="button"
            aria-label="Close introduction"
            className="absolute inset-0 bg-[#12151c]/55"
            onClick={() => dismiss(false)}
          />
          <motion.div
            role="dialog"
            aria-labelledby="aribot-intro-title"
            className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-[#161a22] text-[#f6f3ee] shadow-[0_30px_80px_rgba(18,21,28,0.45)]"
            initial={{ opacity: 0, y: 28, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full bg-[#c4a574]/30 blur-3xl"
              animate={{ scale: [1, 1.08, 1], opacity: [0.45, 0.7, 0.45] }}
              transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            />
            <div className="relative min-h-0 flex-1 overflow-y-auto px-7 pt-7 pb-5">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
              >
                <Orb
                  state="reasoning"
                  variant="twins"
                  size={42}
                  label="ARIBOT"
                  className="text-[#f3e6d0]"
                />
              </motion.div>
              <motion.p
                className="mt-5 text-[11px] tracking-[0.22em] text-[#c4a574] uppercase"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.16 }}
              >
                New in AriForce
              </motion.p>
              <motion.h2
                id="aribot-intro-title"
                className="mt-2 text-3xl font-semibold tracking-tight"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22 }}
              >
                Meet ARIBOT
              </motion.h2>
              <motion.p
                className="mt-2 text-sm leading-relaxed text-[#f6f3ee]/75"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
              >
                Ask a business question in plain language. The answer stays inside what you are
                already allowed to see.
              </motion.p>
              <ul className="mt-5 flex flex-col gap-3">
                {FEATURES.map((feature, i) => (
                  <motion.li
                    key={feature.title}
                    className="rounded-2xl bg-white/[0.04] px-4 py-3"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: 0.38 + i * 0.08,
                      type: 'spring',
                      stiffness: 380,
                      damping: 30,
                    }}
                  >
                    <p className="text-sm font-medium">{feature.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-[#f6f3ee]/65">{feature.body}</p>
                  </motion.li>
                ))}
              </ul>
            </div>
            <div className="relative flex shrink-0 items-center justify-end gap-2 border-t border-white/10 px-7 py-4">
              <Button
                type="button"
                variant="ghost"
                className="text-[#f6f3ee]/70 hover:bg-white/10 hover:text-[#f6f3ee]"
                onClick={() => dismiss(false)}
              >
                Not now
              </Button>
              <Button
                type="button"
                className="bg-[#f3e6d0] text-[#161a22] hover:bg-[#f3e6d0]/90"
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
