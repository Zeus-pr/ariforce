'use client';

import { useEffect, useRef, useState } from 'react';
import { SPLASH_CLASS, SPLASH_KEY } from './splash-script';

const HOLD_MS = 700;
const MOVE_MS = 850;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

export function Splash() {
  const [done, setDone] = useState(false);
  const logoRef = useRef<HTMLImageElement>(null);
  const wordRef = useRef<HTMLParagraphElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    // Already seen this session: the overlay stays display:none via CSS, nothing to run.
    if (!root.classList.contains(SPLASH_CLASS)) return;

    const logo = logoRef.current;
    const word = wordRef.current;
    const veil = veilRef.current;
    const target = document.querySelector<HTMLElement>('[data-af-header-logo]');
    const page = document.querySelectorAll<HTMLElement>('.af-page');
    if (!logo || !word || !veil || !target) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const running: Animation[] = [];
    let cancelled = false;

    const finish = () => {
      if (cancelled) return;
      try {
        sessionStorage.setItem(SPLASH_KEY, '1');
      } catch {
        // sessionStorage can be blocked (private mode); the splash just plays again next load.
      }
      root.classList.remove(SPLASH_CLASS);
      running.forEach((a) => a.cancel());
      setDone(true);
    };

    const fadeIn = (duration: number, delay: number) =>
      [...page].map((el) =>
        el.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration,
          delay,
          easing: 'ease-out',
          fill: 'both',
        }),
      );

    const timer = window.setTimeout(
      () => {
        if (reduced) {
          // No movement: a plain crossfade from splash to page.
          running.push(
            ...fadeIn(250, 0),
            veil.parentElement!.animate([{ opacity: 1 }, { opacity: 0 }], {
              duration: 250,
              fill: 'forwards',
            }),
          );
          Promise.all(running.map((a) => a.finished)).then(finish, () => {});
          return;
        }

        // FLIP: measure both boxes, then move the splash logo onto the header logo with transform only.
        const from = logo.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        const scale = to.width / from.width;
        const dx = to.left - from.left;
        const dy = to.top - from.top;

        const move = logo.animate(
          [
            { transform: 'translate(0px, 0px) scale(1)' },
            { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
          ],
          { duration: MOVE_MS, easing: EASE, fill: 'forwards' },
        );
        running.push(
          move,
          word.animate(
            [
              { opacity: 1, transform: 'translateY(0)' },
              { opacity: 0, transform: 'translateY(-6px)' },
            ],
            { duration: 220, easing: 'ease-out', fill: 'forwards' },
          ),
          veil.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: 500,
            delay: MOVE_MS * 0.35,
            easing: 'ease-out',
            fill: 'forwards',
          }),
          ...fadeIn(500, MOVE_MS * 0.35),
        );
        move.finished.then(finish, () => {});
      },
      reduced ? 300 : HOLD_MS,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      running.forEach((a) => a.cancel());
    };
  }, []);

  if (done) return null;

  return (
    <div
      className="af-splash-overlay pointer-events-none fixed inset-0 z-50"
      aria-hidden="true"
      data-testid="splash"
    >
      <div ref={veilRef} className="absolute inset-0 bg-white" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
        <img
          ref={logoRef}
          src="/brand/ariforce-mark.png"
          alt=""
          width={108}
          height={96}
          data-af-splash-logo
          className="block h-24 w-27 origin-top-left will-change-transform"
        />
        <p ref={wordRef} className="text-2xl font-semibold tracking-tight text-brand-600">
          AriForce
        </p>
      </div>
    </div>
  );
}
