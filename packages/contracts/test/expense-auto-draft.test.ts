import { describe, expect, it } from 'vitest';
import {
  ALLOWANCE_DAY_ISSUES,
  Approval,
  DcrOptions,
  DcrSubmitResult,
  ExpenseAutoDraft,
  ExpenseClaim,
} from '../src';

describe('expense auto-draft contract (Phase B)', () => {
  it('DcrOptions.autoExpenseOnDcrSubmit defaults to false (older API = client drafts)', () => {
    expect(DcrOptions.shape.autoExpenseOnDcrSubmit.parse(undefined)).toBe(false);
  });
  it('DcrSubmitResult.expenseDraft defaults to null', () => {
    expect(DcrSubmitResult.shape.expenseDraft.parse(undefined)).toBeNull();
  });
  it('ExpenseAutoDraft accepts the three outcomes', () => {
    const base = {
      date: '2026-10-05',
      dcrId: '01930000-0000-7000-8000-000000000001',
      claimId: null,
      claimStatus: null,
      claimCreated: false,
      lines: 0,
      da: 0,
      ta: 0,
      km: 0,
      issues: [],
    };
    expect(
      ExpenseAutoDraft.parse({ ...base, status: 'skipped', reason: 'claim_locked', error: null })
        .reason,
    ).toBe('claim_locked');
    expect(
      ExpenseAutoDraft.parse({
        ...base,
        status: 'error',
        reason: null,
        error: { code: 'X', message: 'y' },
      }).status,
    ).toBe('error');
    expect(() =>
      ExpenseAutoDraft.parse({ ...base, status: 'skipped', reason: 'nope', error: null }),
    ).toThrow();
  });
  it('rejected days are an allowance issue; claim and approval carry the flag', () => {
    expect(ALLOWANCE_DAY_ISSUES).toContain('dcr_rejected');
    expect(ExpenseClaim.shape.dcrRejectedDates.parse(undefined)).toEqual([]);
    expect(Approval.shape.flags.parse(['dcr_rejected_lines'])).toEqual(['dcr_rejected_lines']);
  });
});
