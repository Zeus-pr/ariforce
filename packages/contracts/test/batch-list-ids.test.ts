import { describe, expect, it } from 'vitest';
import { DcrWorkWithQuery } from '../src/schemas/dcr';
import { ChemistListQuery, DoctorListQuery, OutletListQuery } from '../src/schemas/masters';

const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';

describe('master batch ids', () => {
  it('accepts comma-separated IDs for doctors, chemists, and stockists', () => {
    const ids = `${firstId},${secondId}`;
    expect(DoctorListQuery.parse({ ids, limit: 100 }).ids).toBe(ids);
    expect(ChemistListQuery.parse({ ids, limit: 100 }).ids).toBe(ids);
    expect(OutletListQuery.parse({ ids, limit: 100 }).ids).toBe(ids);
  });

  it('rejects malformed or oversized ID batches', () => {
    expect(ChemistListQuery.safeParse({ ids: `${firstId},bad` }).success).toBe(false);
    const ids = Array.from({ length: 101 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    ).join(',');
    expect(OutletListQuery.safeParse({ ids }).success).toBe(false);
  });
});

describe('DCR work-with batch ids', () => {
  it('parses saved user IDs as a bounded list', () => {
    expect(DcrWorkWithQuery.parse({ ids: `${firstId},${secondId}` }).ids).toEqual([
      firstId,
      secondId,
    ]);
    const ids = Array.from({ length: 21 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    ).join(',');
    expect(DcrWorkWithQuery.safeParse({ ids }).success).toBe(false);
  });
});
