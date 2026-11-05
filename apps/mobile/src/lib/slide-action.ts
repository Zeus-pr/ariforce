/** Pure slide-to-confirm math (from CUTLY) — no RN gesture runtime. */

export const SLIDE_KNOB_SIZE = 44;
export const SLIDE_TRACK_H = 52;
export const SLIDE_INSET = 4;
/** Fill ratio that counts as complete — do not require the far edge. */
export const SLIDE_COMPLETE_THRESHOLD = 0.72;

export function slideMaxTravel(trackWidth: number, knobSize = SLIDE_KNOB_SIZE) {
  return Math.max(1, trackWidth - knobSize - SLIDE_INSET * 2);
}

export function slideFillFromTranslation(
  translationX: number,
  trackWidth: number,
  knobSize = SLIDE_KNOB_SIZE,
) {
  const max = slideMaxTravel(trackWidth, knobSize);
  const next = Math.min(max, Math.max(0, translationX));
  return next / max;
}

export function shouldCompleteSlide(fill: number, threshold = SLIDE_COMPLETE_THRESHOLD) {
  return fill >= threshold;
}
