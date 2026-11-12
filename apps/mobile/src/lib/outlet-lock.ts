/** Distance and “another chamber” decision. No React Native imports, so tests can load it. */

export const DOCTOR_LOCK_CAP_MIN = 1;
export const DOCTOR_LOCK_CAP_MAX = 5;
export const DEFAULT_DOCTOR_LOCK_CAP = 1;

export function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
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

/** Missing or out-of-range values stay at the default of one pin. */
export function clampDoctorLockCap(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return DEFAULT_DOCTOR_LOCK_CAP;
  return Math.min(DOCTOR_LOCK_CAP_MAX, Math.max(DOCTOR_LOCK_CAP_MIN, value));
}

export function doctorLockLimitMessage(cap: number): string {
  const n = clampDoctorLockCap(cap);
  const places = n === 1 ? 'place' : 'places';
  return `This doctor already has ${n} locked ${places}. Check in near one of them.`;
}

/**
 * A doctor who is outside every saved pin should be offered a new chamber,
 * while they are still under that doctor's cap. Chemists and stockists keep a single pin.
 */
export function shouldOfferAnotherChamber(
  outletKind: 'doctor' | 'chemist' | 'stockist',
  nearestM: number | null,
  radiusM: number,
  activeLocks: number,
  cap: number = DEFAULT_DOCTOR_LOCK_CAP,
): boolean {
  return (
    outletKind === 'doctor' &&
    nearestM != null &&
    nearestM > radiusM &&
    activeLocks < clampDoctorLockCap(cap)
  );
}

export function doctorLockLimitReached(
  outletKind: 'doctor' | 'chemist' | 'stockist',
  activeLocks: number,
  cap: number = DEFAULT_DOCTOR_LOCK_CAP,
): boolean {
  return outletKind === 'doctor' && activeLocks >= clampDoctorLockCap(cap);
}
