import { describe, expect, it } from 'vitest';
import { figureLine, isPastLock, lockInstant, nextMonth, totalsOf } from './math';

describe('stock statement maths', () => {
  it('prices a line in paise and derives closing', () => {
    const line = figureLine({
      openingQty: 100,
      purchaseQty: 0,
      freeQty: 0,
      secondaryQty: 3,
      frsQty: 0,
      pts: 124.11,
    });
    expect(line.openingValue).toBe(12411);
    expect(line.secondaryValue).toBe(372.33);
    expect(line.closingQty).toBe(97);
    expect(line.closingValue).toBe(12038.67);
  });

  it('prices a missing PTS as zero', () => {
    const line = figureLine({
      openingQty: 0,
      purchaseQty: 4,
      freeQty: 0,
      secondaryQty: 1,
      frsQty: 0,
      pts: null,
    });
    expect(line.openingValue).toBe(0);
    expect(line.purchaseValue).toBe(0);
    expect(line.secondaryValue).toBe(0);
    expect(line.closingQty).toBe(3);
    expect(line.closingValue).toBe(0);
  });

  it('keeps a blank opening blank and a typed zero as zero', () => {
    expect(
      figureLine({
        openingQty: null,
        purchaseQty: 0,
        freeQty: 0,
        secondaryQty: 0,
        frsQty: 0,
        pts: 10,
      }).closingQty,
    ).toBeNull();
    expect(
      figureLine({ openingQty: 0, purchaseQty: 0, freeQty: 0, secondaryQty: 0, frsQty: 0, pts: 10 })
        .closingQty,
    ).toBe(0);
  });

  it('actual secondary is secondary value minus FRS value', () => {
    const totals = totalsOf([
      figureLine({
        openingQty: 50,
        purchaseQty: 0,
        freeQty: 5,
        secondaryQty: 10,
        frsQty: 2,
        pts: 100,
      }),
    ]);
    expect(totals.secondaryValue).toBe(1000);
    expect(totals.frsValue).toBe(200);
    expect(totals.actualSecondary).toBe(800);
    expect(totals.freeValue).toBe(500);
    expect(totals.closingQty).toBe(43);
  });

  it('locks a month at 11:59 pm on the 6th of the next month', () => {
    const lock = lockInstant('2026-11-01', 'Asia/Kolkata');
    expect(lock.toISOString()).toBe('2026-12-06T18:29:59.999Z');
    expect(isPastLock('2026-11', new Date('2026-12-06T18:29:59.999Z'), 'Asia/Kolkata')).toBe(false);
    expect(isPastLock('2026-11', new Date('2026-12-06T18:30:00.000Z'), 'Asia/Kolkata')).toBe(true);
  });

  it('steps a month forward', () => {
    expect(nextMonth('2026-10-01')).toBe('2026-11-01');
    expect(nextMonth('2026-12-01')).toBe('2027-01-01');
  });
});
