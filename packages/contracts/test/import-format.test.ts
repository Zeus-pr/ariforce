import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mapImportRow, UploadUrlRequest, type ImportJob, type ImportLookup } from '../src';
import { createHandlers } from '../src/mocks';
import * as fx from '../src/mocks/fixtures';

const BASE = 'http://import.test';
const server = setupServer(...createHandlers(BASE));
beforeAll(() => server.listen());
afterAll(() => server.close());

const lk: ImportLookup = {
  territory: (c) => (c === 'HQ1' ? '01930000-0000-7000-8000-000000000101' : undefined),
  specialty: () => undefined,
  category: (c) => (c === 'A' ? '01930000-0000-7000-8000-000000000102' : undefined),
  division: () => undefined,
  product: () => undefined,
};

describe('one import row format (gap #1)', () => {
  it('maps snake_case template columns with codes; camelCase + *_id are aliases', () => {
    const a = mapImportRow(
      'doctors',
      { name: 'Dr. X', territory_code: 'hq1', category_code: 'a', 'Pin Code': '' },
      lk,
    );
    expect(a.errors).toEqual([]);
    expect(a.body).toMatchObject({
      territoryId: lk.territory('HQ1'),
      categoryId: lk.category('A'),
    });
    const b = mapImportRow('doctors', { name: 'Dr. X', territoryCode: 'HQ1' }, lk);
    expect(b.body?.territoryId).toBe(lk.territory('HQ1'));
    const c = mapImportRow(
      'doctors',
      { name: 'Dr. X', territoryId: lk.territory('HQ1'), location: { lat: 1, lng: 2 } },
      lk,
    );
    expect(c.body).toMatchObject({ location: { lat: 1, lng: 2 } });
  });
  it('reports errors by template column', () => {
    const r = mapImportRow(
      'doctors',
      { name: 'Dr. X', territory_code: 'NOPE', pincode: '12', lat: 5 },
      lk,
    );
    expect(r.body).toBeNull();
    expect(r.errors.map((e) => e.column).sort()).toEqual(['lng', 'pincode', 'territory_code']);
  });
  it('mock import uses the same mapper', async () => {
    const t = fx.territories.at(-1)!;
    const res = await fetch(`${BASE}/v1/doctors/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rows: [
          { name: 'Dr. Mock', territory_code: t.code },
          { name: 'Dr. Bad', territory_code: 'ZZZ' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const job = (await res.json()) as ImportJob;
    expect(job.results.map((r) => r.status)).toEqual(['valid', 'error']);
    expect(job.results[1]!.errors[0]!.column).toBe('territory_code');
  });
  it('import_source upload purpose only accepts csv/xlsx (gap #2)', () => {
    expect(
      UploadUrlRequest.safeParse({
        purpose: 'import_source',
        contentType: 'text/csv',
        sizeBytes: 1,
      }).success,
    ).toBe(true);
    expect(
      UploadUrlRequest.safeParse({
        purpose: 'import_source',
        contentType: 'image/png',
        sizeBytes: 1,
      }).success,
    ).toBe(false);
    expect(
      UploadUrlRequest.safeParse({ purpose: 'avatar', contentType: 'text/csv', sizeBytes: 1 })
        .success,
    ).toBe(false);
  });
});
