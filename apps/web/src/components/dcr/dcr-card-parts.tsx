'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Dcr } from '@ariforce/contracts';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { BANDS } from '@/lib/dcr/model';

/** Shared by the drafts and history lists of the DCR page. */
export const MOTION_MS = 240;
export const calls = (n: number) => `${n} call${n === 1 ? '' : 's'}`;
export const istLabel = (iso: string) =>
  `${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso))} IST`;

/** "Field work · HQ · Durgapur · 3 calls" for a report card. */
export function dcrSummary(d: Dcr, workType: string | undefined, placeName: Map<string, string>) {
  const band = BANDS.find((b) => b.band === d.band);
  const places = d.territoryIds.map((id) => placeName.get(id)).filter(Boolean) as string[];
  const territory = places.length
    ? places.join(', ')
    : d.territoryIds.length
      ? `${d.territoryIds.length} ${d.territoryIds.length === 1 ? 'territory' : 'territories'}`
      : null;
  const what =
    workType ??
    (band
      ? 'Field work'
      : d.details?.kind
        ? d.details.kind[0]!.toUpperCase() + d.details.kind.slice(1)
        : 'Report');
  const n = d.callCount ?? d.calls.length;
  return [what, band ? band.label : null, territory, band || n ? calls(n) : null]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Height + opacity reveal (grid rows 0fr → 1fr), ease-out; instant when the OS asks for reduced motion.
 * `appear` animates the first render; `closing` collapses it, then `onClosed` runs.
 */
export function Reveal({
  closing,
  onClosed,
  appear = true,
  children,
}: {
  closing: boolean;
  onClosed: () => void;
  appear?: boolean;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const [on, setOn] = useState(!appear);
  const [settled, setSettled] = useState(!appear);
  const closedRef = useRef(onClosed);
  useEffect(() => {
    closedRef.current = onClosed;
  });
  useEffect(() => {
    if (on) return;
    const r = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(r);
  }, [on]);
  useEffect(() => {
    if (!closing) return;
    setSettled(false);
    const t = window.setTimeout(() => closedRef.current(), reduced ? 0 : MOTION_MS);
    return () => window.clearTimeout(t);
  }, [closing, reduced]);
  const expanded = on && !closing;
  return (
    <div
      className="af-reveal"
      data-open={expanded}
      data-settled={(expanded && (settled || reduced)) || undefined}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'grid-template-rows' && expanded)
          setSettled(true);
      }}
    >
      <div>{children}</div>
    </div>
  );
}
