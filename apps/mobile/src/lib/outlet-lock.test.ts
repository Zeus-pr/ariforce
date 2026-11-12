/// <reference types="jest" />
import { metres, nearestLockMetres, shouldOfferAnotherChamber } from '@/lib/outlet-lock';

describe('another doctor chamber', () => {
  const here = { lat: 23.23, lng: 87.07 };
  const near = { location: { lat: 23.2302, lng: 87.0702 } };
  const far = { location: { lat: 23.28, lng: 87.12 } };

  it('measures a short walk as inside a 300 m fence', () => {
    expect(metres(here, near.location)).toBeLessThan(300);
    expect(nearestLockMetres(here, [far, near])).toBeLessThan(300);
  });

  it('offers a new pin only for a doctor outside every saved pin', () => {
    const farM = nearestLockMetres(here, [far])!;
    expect(farM).toBeGreaterThan(300);
    expect(shouldOfferAnotherChamber('doctor', farM, 300)).toBe(true);
    expect(shouldOfferAnotherChamber('doctor', 40, 300)).toBe(false);
    expect(shouldOfferAnotherChamber('doctor', null, 300)).toBe(false);
    expect(shouldOfferAnotherChamber('chemist', farM, 300)).toBe(false);
    expect(shouldOfferAnotherChamber('stockist', farM, 300)).toBe(false);
  });
});
