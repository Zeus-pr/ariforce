import { describe, expect, it } from 'vitest';
import { codeFamily, formatEmployeeCode, isFamilyCode } from './employee-code';

describe('employee codes', () => {
  it('keeps a family when the designation changes', () => {
    expect(codeFamily('business_manager')).toBe('ARISLS');
    expect(codeFamily('vice_president')).toBe('ARISLS');
    expect(codeFamily('director')).toBe('ARIDIR');
    expect(codeFamily('system_admin')).toBe('ARIADM');
    expect(codeFamily('hr')).toBe('ARIHRM');
    expect(codeFamily('distribution_head')).toBe('ARIDST');
    expect(codeFamily('accountant')).toBe('ARIACC');
    expect(formatEmployeeCode('ARISLS', 12)).toBe('ARISLS000012');
    expect(isFamilyCode('ARISLS000012')).toBe(true);
    expect(isFamilyCode('ARI-001')).toBe(false);
  });
});
