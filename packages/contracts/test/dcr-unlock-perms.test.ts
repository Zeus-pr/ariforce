import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, ROLE_KEYS } from '../src/schemas/roles';

describe('DCR unlock decisions are director-only (2026-10-29)', () => {
  it('only director holds dcr_unlock:decide', () => {
    expect(
      ROLE_KEYS.filter((k) => DEFAULT_ROLE_PERMISSIONS[k].includes('dcr_unlock:decide')),
    ).toEqual(['director']);
  });
  it('dcr:review and approvals:decide stay on ABM and above', () => {
    for (const k of [
      'area_business_manager',
      'regional_business_manager',
      'zonal_business_manager',
      'sales_manager',
      'general_manager',
      'vice_president',
      'director',
    ] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[k]).toContain('dcr:review');
      expect(DEFAULT_ROLE_PERMISSIONS[k]).toContain('approvals:decide');
    }
    expect(DEFAULT_ROLE_PERMISSIONS.business_manager).not.toContain('dcr:review');
  });
});
