'use client';

import type { ComponentType } from 'react';
import GhostFibersBase from './GhostFibers.jsx';

type GhostFibersProps = {
  glowColor?: string;
  lineColor?: string;
  secondaryColor?: string;
  layers?: number;
  twist?: number;
  threads?: number;
  fiberStyle?: 'dots' | 'dashes' | 'lines';
  thickness?: number;
  depthOfField?: number;
  hoverEffect?: 'focus' | 'part' | 'none';
  intro?: boolean;
  mouseInteraction?: boolean;
  lightMode?: boolean;
};

// The official file leaves `dpr` without a default, so allowJs treats it as required.
const GhostFibers = GhostFibersBase as ComponentType<GhostFibersProps>;

/** Approved Ghost Fibers backdrop. Light mode draws ink on the white page; thickness shrinks the dots. */
export function AuthFibers() {
  return (
    <div className="pointer-events-none fixed inset-0" aria-hidden>
      <GhostFibers
        glowColor="#06b6d4"
        lineColor="#ec4899"
        secondaryColor="#000853"
        layers={3}
        twist={1.2}
        threads={72}
        fiberStyle="dots"
        thickness={0.45}
        depthOfField={0.85}
        hoverEffect="focus"
        intro
        mouseInteraction
        lightMode
      />
    </div>
  );
}
