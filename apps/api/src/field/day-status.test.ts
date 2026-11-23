import { describe, expect, it } from 'vitest';
import { blocksNextPunchIn, isAbsentDay } from './day-status';

describe('absent days', () => {
  const base = { today: '2026-11-24', punchedIn: false, leave: false, holiday: false };

  it('marks a finished working day from 23 Nov with no punch', () => {
    expect(isAbsentDay({ ...base, date: '2026-11-23' })).toBe(true);
  });

  it('leaves today, earlier days, Sunday, a holiday, leave, and a punched day clear', () => {
    expect(isAbsentDay({ ...base, date: '2026-11-24' })).toBe(false);
    expect(isAbsentDay({ ...base, date: '2026-11-22' })).toBe(false);
    expect(isAbsentDay({ ...base, date: '2026-11-20' })).toBe(false);
    expect(isAbsentDay({ ...base, date: '2026-11-23', holiday: true })).toBe(false);
    expect(isAbsentDay({ ...base, date: '2026-11-23', leave: true })).toBe(false);
    expect(isAbsentDay({ ...base, date: '2026-11-23', punchedIn: true })).toBe(false);
  });
});

describe('next punch-in', () => {
  it('blocks only when yesterday was punched and the report was not submitted', () => {
    expect(blocksNextPunchIn({ punchedIn: true, submitted: false })).toBe(true);
    expect(blocksNextPunchIn({ punchedIn: true, submitted: true })).toBe(false);
    expect(blocksNextPunchIn({ punchedIn: false, submitted: false })).toBe(false);
  });
});
