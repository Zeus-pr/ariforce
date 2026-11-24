import { describe, expect, it } from 'vitest';
import { payslipAmounts, splitCtc, unpaidDays } from './math';

describe('payslip amounts', () => {
  it('keeps a full month at the structure amounts', () => {
    const slip = payslipAmounts({
      basic: 10000,
      hra: 4000,
      special: 6000,
      professionalTax: 0,
      bonusDeduction: 800,
      totalDays: 30,
      unpaidDays: 0,
    });
    expect(slip.gross).toBe(20000);
    expect(slip.esi).toBe(150);
    expect(slip.net).toBe(19050);
  });

  it('drops one absent day from earnings and recomputes ESI', () => {
    const slip = payslipAmounts({
      basic: 10000,
      hra: 4000,
      special: 6000,
      professionalTax: 0,
      bonusDeduction: 800,
      totalDays: 30,
      unpaidDays: 1,
    });
    expect(slip.paidDays).toBe(29);
    expect(slip.basic).toBe(9667);
    expect(slip.gross).toBe(19334);
    expect(slip.esi).toBe(145);
  });

  it('splits a yearly cost into basic, HRA and special allowance', () => {
    expect(splitCtc(240000)).toEqual({ basic: 10000, hra: 4000, special: 6000 });
    expect(splitCtc(1270000)).toEqual({ basic: 52917, hra: 21167, special: 31750 });
    expect(splitCtc(350000)).toEqual({ basic: 14583, hra: 5833, special: 8750 });
  });

  it('counts loss of pay instead of absent on the same day', () => {
    expect(
      unpaidDays([
        { lop: 1, absent: true },
        { lop: 0.5, absent: false },
        { lop: null, absent: true },
        { lop: null, absent: false },
      ]),
    ).toBe(2.5);
  });
});
