import { describe, expect, it } from 'vitest';
import { SFC_CATEGORY_BAND, SfcRouteInput } from '../src/schemas/sfc';

const row = (category: unknown) => ({ fromPlace: 'A', toPlace: 'B', oneWayKm: 1, category });

describe('SFC category enum', () => {
  it('accepts ex / hq / os and null, maps to DCR bands', () => {
    for (const c of ['ex', 'hq', 'os', null])
      expect(SfcRouteInput.safeParse(row(c)).success).toBe(true);
    expect(SFC_CATEGORY_BAND).toEqual({ ex: 'ex_hq', hq: 'hq', os: 'outstation' });
  });
  it('rejects legacy or free text', () => {
    for (const c of ['EX', 'EX HQ', 'EX / OS', 'MEETING', ''])
      expect(SfcRouteInput.safeParse(row(c)).success).toBe(false);
  });
});
