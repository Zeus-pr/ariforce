/**
 * Metres to send with a punch or visit. A missing or negative reading is not a fix:
 * inventing 100 m would pass the server accuracy cap.
 */
export function accuracyMetres(accuracy: number | null | undefined): number {
  if (accuracy == null || !Number.isFinite(accuracy) || accuracy < 0)
    throw new Error('GPS accuracy is not available. Wait for a better fix and try again.');
  return Math.min(10000, Math.round(accuracy));
}
