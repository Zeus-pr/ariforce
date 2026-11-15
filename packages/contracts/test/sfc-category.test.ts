import { describe, expect, it } from 'vitest';
import { SFC_CATEGORY_BAND, SfcRouteInput, sfcCategoryLabel } from '../src/schemas/sfc';

const row = (category: unknown) => ({ fromPlace: 'A', toPlace: 'B', oneWayKm: 1, category });
const saved = (category: unknown) => SfcRouteInput.parse(row(category)).category;

describe('SFC category enum', () => {
  it('accepts ex / hq / os and null, maps to DCR bands', () => {
    for (const c of ['ex', 'hq', 'os', null])
      expect(SfcRouteInput.safeParse(row(c)).success).toBe(true);
    expect(SFC_CATEGORY_BAND).toEqual({ ex: 'ex_hq', hq: 'hq', os: 'outstation' });
  });
  it('treats the dropdown labels as the same categories', () => {
    expect(saved('HQ')).toBe('hq');
    expect(saved('hq')).toBe('hq');
    expect(saved('EX')).toBe('ex');
    expect(saved('EX HQ')).toBe('ex');
    expect(saved('OS')).toBe('os');
    expect(saved('OUT EX HQ')).toBe('os');
    expect(saved('EX / OS')).toBe('EX / OS');
    expect(saved('MEETING')).toBe('MEETING');
    expect(saved('')).toBeNull();
    expect(sfcCategoryLabel('hq')).toBe('HQ');
    expect(sfcCategoryLabel('ex')).toBe('EX');
    expect(sfcCategoryLabel('os')).toBe('OS');
  });
  it('rejects a category that is not one of the SFC choices', () => {
    expect(SfcRouteInput.safeParse(row('weekend')).success).toBe(false);
  });
});
