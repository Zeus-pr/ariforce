import { describe, expect, it } from 'vitest';
import { hasPlannedDay, istDate, missingRequiredDates, monthDates, requiredDates } from '../src';

// 2026-10: Oct 1 is a Thursday; Sundays are 4, 11, 18, 25.
const SUN = ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'];
const entry = (date: string) => ({ date, entries: [{}] });

describe('tour-plan submit rule: at least one planned day', () => {
  it('empty plan or days without entries cannot be submitted; one day is enough', () => {
    expect(hasPlannedDay([])).toBe(false);
    expect(hasPlannedDay([{ date: '2026-11-03', entries: [] }])).toBe(false);
    expect(hasPlannedDay([entry('2026-11-03')])).toBe(true);
  });
});

describe('requiredDates (deprecated, informational only)', () => {
  it('weekly offs never count', () => {
    expect(
      requiredDates('2026-12', '2026-10-27', [0]).some((d) => new Date(d).getUTCDay() === 0),
    ).toBe(false);
    expect(requiredDates('2026-12', '2026-10-27', [0, 6])).toHaveLength(23); // Dec 2026: 31 - 4 Sun - 4 Sat
  });
  it('current month: past dates are ignored and today counts', () => {
    const r = requiredDates('2026-10', '2026-10-27', [0]);
    expect(r).toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
    expect(r).toContain('2026-10-27');
    expect(r.every((d) => d >= '2026-10-27')).toBe(true);
  });
  it('current month with only past days missing has nothing missing', () => {
    const days = ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'].map(entry);
    expect(missingRequiredDates('2026-10', days, '2026-10-27', [0])).toEqual([]);
    expect(missingRequiredDates('2026-10', days.slice(1), '2026-10-27', [0])).toEqual([
      '2026-10-27',
    ]);
  });
  it('future month unchanged: every non-off date', () => {
    const r = requiredDates('2026-11', '2026-10-27', [0]);
    expect(r).toEqual(monthDates('2026-11').filter((d) => new Date(d).getUTCDay() !== 0));
    expect(r).toHaveLength(25);
  });
  it('past month keeps requiring every non-off date', () => {
    expect(requiredDates('2026-10', '2026-11-02', [0])).toEqual(
      monthDates('2026-10').filter((d) => !SUN.includes(d)),
    );
  });
  it('istDate uses Asia/Kolkata', () => {
    expect(istDate(new Date('2026-10-26T19:00:00Z'))).toBe('2026-10-27'); // 00:30 IST
    expect(istDate(new Date('2026-10-26T18:00:00Z'))).toBe('2026-10-26'); // 23:30 IST
  });
});
