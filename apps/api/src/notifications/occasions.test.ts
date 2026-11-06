import { describe, expect, it } from 'vitest';
import { daysUntilOccasion, occasionSummary, occasionTitle, occasionWhen } from './occasions';

describe('doctor occasion window', () => {
  it('includes today through five days ahead and ignores the year', () => {
    expect(daysUntilOccasion('1980-11-06', '2026-11-06')).toBe(0);
    expect(daysUntilOccasion('1980-11-11', '2026-11-06')).toBe(5);
    expect(daysUntilOccasion('1980-11-12', '2026-11-06')).toBeNull();
    expect(daysUntilOccasion('1980-11-05', '2026-11-06')).toBeNull();
  });

  it('wraps across the new year', () => {
    expect(daysUntilOccasion('1972-01-02', '2026-12-30')).toBe(3);
  });

  it('skips blank and unreadable dates', () => {
    expect(daysUntilOccasion(null, '2026-11-06')).toBeNull();
    expect(daysUntilOccasion('  ', '2026-11-06')).toBeNull();
    expect(daysUntilOccasion('06-11', '2026-11-06')).toBeNull();
  });

  it('keeps a 29 February date on the 28th in a non-leap year', () => {
    expect(daysUntilOccasion('2000-02-29', '2026-02-28')).toBe(0);
    expect(daysUntilOccasion('2000-02-29', '2028-02-29')).toBe(0);
  });

  it('names today, tomorrow, and a short list', () => {
    expect(occasionWhen(0)).toBe('today');
    expect(occasionWhen(1)).toBe('tomorrow');
    expect(occasionWhen(4)).toBe('in 4 days');
    expect(occasionTitle([{ kind: 'birthday' }, { kind: 'birthday' }])).toBe('Birthdays coming up');
    expect(occasionTitle([{ kind: 'anniversary' }])).toBe('Anniversaries coming up');
    expect(occasionTitle([{ kind: 'birthday' }, { kind: 'anniversary' }])).toBe(
      'Doctor dates coming up',
    );
    expect(
      occasionSummary([
        { name: 'Dr Sharma', kind: 'birthday', days: 1 },
        { name: 'Dr Rao', kind: 'anniversary', days: 0 },
      ]),
    ).toBe('Dr Sharma: birthday tomorrow\nDr Rao: anniversary today');
  });
});
