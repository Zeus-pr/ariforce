import { describe, expect, it } from 'vitest';
import { holidayDate } from './holiday-date';

describe('holidayDate', () => {
  it('keeps 26 January on that calendar day when the driver returns local midnight', () => {
    expect(holidayDate(new Date(2027, 0, 26, 0, 0, 0))).toBe('2027-01-26');
    expect(holidayDate('2027-01-26')).toBe('2027-01-26');
    expect(holidayDate('2027-01-26T00:00:00.000Z')).toBe('2027-01-26');
  });
});
