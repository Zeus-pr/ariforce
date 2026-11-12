/** Distance and “another chamber” decision. No React Native imports, so tests can load it. */

export function metres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Metres to the closest pin. Null when the outlet has no pin yet. */
export function nearestLockMetres(
  here: { lat: number; lng: number },
  locks: { location: { lat: number; lng: number } }[],
): number | null {
  if (!locks.length) return null;
  return Math.min(...locks.map((lock) => metres(here, lock.location)));
}

/**
 * A doctor who is outside every saved pin should be offered a new chamber.
 * Chemists and stockists keep a single pin.
 */
export function shouldOfferAnotherChamber(
  outletKind: 'doctor' | 'chemist' | 'stockist',
  nearestM: number | null,
  radiusM: number,
): boolean {
  return outletKind === 'doctor' && nearestM != null && nearestM > radiusM;
}
