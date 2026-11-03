import { describe, expect, it } from 'vitest';
import type { DcrDetails } from '@ariforce/contracts';
import { normaliseDetails } from './details-rules';

const n = (d: unknown) =>
  normaliseDetails(d as DcrDetails) as Extract<DcrDetails, { kind: 'meeting' }> | null;
const code = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as { getResponse(): { code: string } }).getResponse().code;
  }
};
const m = { kind: 'meeting', title: 'Cycle Meeting', mode: 'online', startTime: '10:00' } as const;

describe('normaliseDetails', () => {
  it('derives durationMin and ignores the sent one', () => {
    expect(n({ ...m, endTime: '10:45', durationMin: 5 })?.durationMin).toBe(45);
  });
  it('rules', () => {
    expect(code(() => n({ ...m, title: 'Other', durationMin: 5 }))).toBe('MEETING_TYPE_INVALID');
    expect(code(() => n({ ...m, endTime: '09:59' }))).toBe('END_TIME_NOT_AFTER_START');
    expect(code(() => n({ ...m, startTime: '00:00', endTime: '12:01' }))).toBe('DURATION_TOO_LONG');
    expect(n({ ...m, startTime: '00:00', endTime: '12:00' })?.durationMin).toBe(720);
    expect(code(() => n({ ...m }))).toBe('VALIDATION');
    expect(
      code(() => n({ kind: 'office', taskType: 't', description: 'd', endTime: '10:00' })),
    ).toBe('END_TIME_NOT_AFTER_START');
    expect(n({ kind: 'leave', leaveRequestId: 'x' })).toEqual({
      kind: 'leave',
      leaveRequestId: 'x',
    });
  });
});
