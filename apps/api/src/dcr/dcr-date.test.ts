import { describe, expect, it } from 'vitest';
import { assertDcrDateWritable, dcrToday } from './dcr-date';

// 2026-11-03 12:00 IST = 06:30Z
const NOON = new Date('2026-11-03T06:30:00Z');
const code = (f: () => void) => {
  try {
    f();
    return 'ok';
  } catch (e) {
    return (e as { getResponse(): { code: string } }).getResponse().code;
  }
};

describe('DCR date rule (today in Asia/Kolkata only)', () => {
  it('today ok', () => {
    expect(code(() => assertDcrDateWritable('2026-11-03', { unlocked: false, now: NOON }))).toBe(
      'ok',
    );
  });
  it('yesterday rejected', () => {
    expect(code(() => assertDcrDateWritable('2026-11-02', { unlocked: false, now: NOON }))).toBe(
      'DCR_DATE_NOT_TODAY',
    );
  });
  it('tomorrow rejected, even if "unlocked"', () => {
    expect(code(() => assertDcrDateWritable('2026-11-04', { unlocked: true, now: NOON }))).toBe(
      'DCR_DATE_NOT_TODAY',
    );
  });
  it('unlocked past day stays fillable / re-submittable', () => {
    expect(code(() => assertDcrDateWritable('2026-11-01', { unlocked: true, now: NOON }))).toBe(
      'ok',
    );
  });
  it('midnight IST boundary, not UTC or server zone', () => {
    // 23:59:59 IST on 3 Nov = 18:29:59Z; 00:00 IST on 4 Nov = 18:30Z (still 3 Nov in UTC).
    expect(dcrToday(new Date('2026-11-03T18:29:59Z'))).toBe('2026-11-03');
    expect(dcrToday(new Date('2026-11-03T18:30:00Z'))).toBe('2026-11-04');
    const after = new Date('2026-11-03T18:30:00Z');
    expect(code(() => assertDcrDateWritable('2026-11-03', { unlocked: false, now: after }))).toBe(
      'DCR_DATE_NOT_TODAY',
    );
    expect(code(() => assertDcrDateWritable('2026-11-04', { unlocked: false, now: after }))).toBe(
      'ok',
    );
  });
});
