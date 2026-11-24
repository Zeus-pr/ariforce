/** Basic is half the yearly cost, HRA is 40% of basic, special allowance is the remaining 30%. */
export function splitCtc(ctc: number) {
  return {
    basic: Math.round((ctc * 0.5) / 12),
    hra: Math.round((ctc * 0.2) / 12),
    special: Math.round((ctc * 0.3) / 12),
  };
}

/** Full-month lines scaled by paid days. ESI is 0.75% of the earned gross, rounded to a rupee. */
export function payslipAmounts(a: {
  basic: number;
  hra: number;
  special: number;
  professionalTax: number;
  bonusDeduction: number;
  totalDays: number;
  unpaidDays: number;
}) {
  const paidDays = Math.max(0, a.totalDays - a.unpaidDays);
  const scale = a.totalDays > 0 ? paidDays / a.totalDays : 0;
  const basic = Math.round(a.basic * scale);
  const hra = Math.round(a.hra * scale);
  const special = Math.round(a.special * scale);
  const gross = basic + hra + special;
  const esi = Math.round(gross * 0.0075);
  const deductions = a.professionalTax + esi + a.bonusDeduction;
  return {
    paidDays,
    basic,
    hra,
    special,
    gross,
    esi,
    professionalTax: a.professionalTax,
    bonusDeduction: a.bonusDeduction,
    deductions,
    net: gross - deductions,
  };
}

/** Approved loss of pay, else an Absent working day. A day is never both. */
export function unpaidDays(days: { lop: number | null; absent: boolean }[]) {
  return days.reduce((n, day) => n + (day.lop != null ? day.lop : day.absent ? 1 : 0), 0);
}
