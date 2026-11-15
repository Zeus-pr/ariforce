import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS,
  monthsBetween,
  SalesActualCreate,
  SalesImportRequest,
  SalesTargetSet,
} from '../src';

const id = '0198a000-0000-7000-8000-000000000001';

describe('sales:write', () => {
  it('is held by director and system_admin only', () => {
    const holders = Object.entries(DEFAULT_ROLE_PERMISSIONS)
      .filter(([, p]) => (p as string[]).includes('sales:write'))
      .map(([r]) => r)
      .sort();
    expect(holders).toEqual(['director', 'system_admin']);
  });
});

describe('sales contracts', () => {
  it('lists every month of a period, across a year end', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });
  it('rejects a target period that ends before it starts', () => {
    const r = SalesTargetSet.safeParse({
      territoryId: id,
      kind: 'primary',
      fromMonth: '2026-05',
      toMonth: '2026-04',
      value: 100,
    });
    expect(r.success).toBe(false);
  });
  it('defaults a target to per-month and no overwrite', () => {
    const r = SalesTargetSet.parse({
      territoryId: id,
      kind: 'secondary',
      fromMonth: '2026-04',
      toMonth: '2026-06',
      value: 300,
    });
    expect(r).toMatchObject({ spread: 'each', overwrite: false });
  });
  it('rejects a negative actual and an empty import', () => {
    expect(
      SalesActualCreate.safeParse({
        territoryId: id,
        productId: id,
        month: '2026-04',
        kind: 'primary',
        value: -1,
      }).success,
    ).toBe(false);
    expect(SalesImportRequest.safeParse({ entity: 'actuals', rows: [] }).success).toBe(false);
  });
});
