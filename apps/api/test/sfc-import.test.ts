import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_COMPANY_ID as A, U } from '@ariforce/db';
import {
  matchSheet,
  normCategory,
  parseKm,
  parseMode,
  parseSfcWorkbook,
  similarity,
} from '../src/sfc/sfc-import';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;

/** Synthetic workbook in the real layout (fake names only). */
async function workbook(file: string) {
  const wb = new ExcelJS.Workbook();
  const add = (title: string, bm: string, hq: string, rows: unknown[][]) => {
    const ws = wb.addWorksheet(title);
    ws.addRow([]);
    ws.addRow([null, 'BM NAME :', bm, `      HQ : ${hq}`]);
    ws.addRow([
      'SL. NO',
      'FROM PLACE',
      'TO PLACE',
      'Distance One way',
      'Distance Both way',
      'Amount One Way',
      'Amount Both Way',
      'Travel_Mode',
      'Category',
    ]);
    for (const r of rows) ws.addRow(r);
  };
  add('SHYAMBAZAR HQ_SFC FORMAT', 'RIYAA BM', 'SHYAMBAZAR', [
    [1, 'SHYAMBAZAR ', 'SHYAMBAZAR', '0', '0', 0, 0, 'BIKE', 'HQ'],
    [2, 'SHYAMBAZAR', 'NORTHVILLE', '30 KM', '60 KM', 88.05, { formula: 'F5*2' }, 'BIKE', 'EX HQ'],
    [3, 'SHYAMBAZAR', 'MIDTOWN', '10 KM', '20 KM', 29.5, 59, 'BIKE', 'EX/ OS'],
    [
      4,
      'SHYAMBAZAR',
      'BIGCITY',
      '102KM',
      '204 KM',
      'ACTUAL FARE',
      'ACTUAL FARE',
      'BUS / TRAIN',
      'OUT EX HQ',
    ],
    [5, null, null, null, null, null, null, null, null],
    [6],
  ]);
  add('NOWHERE HQ_SFC FORMAT', 'ZED NOBODY', 'NOWHERE', [
    [1, 'A', 'B', '5 KM', '10 KM', 14.75, 29.5, 'BIKE', 'EX'],
  ]);
  await wb.xlsx.writeFile(file);
}

describe('SFC import helpers', () => {
  it('cleans km, modes and categories', () => {
    expect(parseKm('71 KM')).toBe(71);
    expect(parseKm('67 KM ')).toBe(67);
    expect(parseKm('50KM')).toBe(50);
    expect(parseKm('0')).toBe(0);
    expect(parseKm(0)).toBe(0);
    expect(parseKm('ACTUAL FARE')).toBeNull();
    expect(parseMode('BUS / TRAIN')).toBe('bus_train');
    expect(parseMode('BIKE')).toBe('bike');
    expect(normCategory(' OUT EX HQ ')).toBe('os');
    expect(normCategory('EX HQ')).toBe('ex');
    expect(normCategory('HQ')).toBe('hq');
    expect(normCategory('OS')).toBe('os');
    expect(normCategory('')).toBeNull();
    expect(normCategory('EX/ OS')).toBeUndefined();
    expect(normCategory('MEETING')).toBeUndefined();
  });
  it('fuzzy-matches close spellings by name and HQ, reports ambiguity', () => {
    expect(similarity('SUROJIT SHIKARI', 'Suraji Shikari')).toBeGreaterThanOrEqual(0.75);
    const hqs = [{ id: 'h1', name: 'Burdwan Anamoy', code: 'HQ-BURDWAN-ANAMOY' }];
    const m = matchSheet({ bmName: 'SUROJIT SHIKARI', hqText: 'BURDWAN - ANAMOY' }, [
      { id: 'u1', name: 'Suraji Shikari', hqs },
      { id: 'u2', name: 'Other Person', hqs },
    ]);
    expect(m.kind).toBe('matched');
    const amb = matchSheet({ bmName: 'AMIT ROY', hqText: 'BURDWAN ANAMOY' }, [
      { id: 'u1', name: 'Amit Roy', hqs },
      { id: 'u2', name: 'Amit Roy', hqs },
    ]);
    expect(amb.kind).toBe('ambiguous');
    const wrongHq = matchSheet({ bmName: 'AMIT ROY', hqText: 'ASANSOL' }, [
      { id: 'u1', name: 'Amit Roy', hqs },
    ]);
    expect(wrongHq.kind).toBe('unmatched');
  });
  it('parses the layout, skips empty numbered rows, flags actual fare', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sfc-'));
    try {
      const f = join(dir, 'sfc.xlsx');
      await workbook(f);
      const [s] = await parseSfcWorkbook(f);
      expect(s!.bmName).toBe('RIYAA BM');
      expect(s!.hqText).toBe('SHYAMBAZAR');
      expect(s!.rows).toHaveLength(3);
      expect(s!.skippedEmpty).toBe(2);
      expect(s!.rows[0]!.fromPlace).toBe('SHYAMBAZAR');
      expect(s!.rows[2]).toMatchObject({
        oneWayKm: 102,
        actualFare: true,
        travelMode: 'bus_train',
      });
      expect(s!.rows[1]!.category).toBe('ex');
      expect(s!.rows[2]!.category).toBe('os');
      expect(s!.problems.join(';')).toMatch(/unknown category 'EX\/ OS' \(row skipped\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!OWNER || !APP)('import-sfc script (real DB)', () => {
  let owner: Pool;
  let dir: string;
  let file: string;
  const run = (...args: string[]) => {
    try {
      return {
        code: 0,
        out: execFileSync(
          process.execPath,
          [
            '--import',
            'tsx',
            resolve(process.cwd(), 'scripts/import-sfc.mts'),
            '--company',
            'demo',
            '--file',
            file,
            ...args,
          ],
          { encoding: 'utf8', env: process.env },
        ),
      };
    } catch (e) {
      const x = e as { status: number; stdout: string };
      return { code: x.status, out: x.stdout + String((x as { stderr?: string }).stderr ?? '') };
    }
  };
  const count = async () =>
    (
      await owner.query(
        `select count(*)::int n from sfc_routes where user_id = $1 and deleted_at is null`,
        [U.rep],
      )
    ).rows[0].n as number;

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER });
    await owner.query(`delete from sfc_routes where company_id = $1`, [A]);
    dir = mkdtempSync(join(tmpdir(), 'sfc-'));
    file = join(dir, 'sfc.xlsx');
    await workbook(file);
  });
  afterAll(async () => {
    await owner.query(`delete from sfc_routes where company_id = $1`, [A]);
    await owner.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it('dry run writes nothing and reports the unmatched sheet', async () => {
    const r = run();
    expect(r.out).toContain('DRY RUN');
    expect(r.out).toContain('Riya BM');
    expect(r.out).toMatch(/NOWHERE.*SKIPPED unmatched/);
    expect(r.code).toBe(2);
    expect(await count()).toBe(0);
  });

  it('--apply writes computed amounts; re-run is idempotent', async () => {
    run('--apply');
    expect(await count()).toBe(3);
    const rows = (
      await owner.query(
        `select to_place, one_way_amount, both_way_amount, actual_fare, travel_mode, category
         from sfc_routes where user_id = $1 and deleted_at is null order by sort_order`,
        [U.rep],
      )
    ).rows;
    expect(rows[1]).toMatchObject({
      one_way_amount: '88.50',
      both_way_amount: '177.00',
      category: 'ex',
    });
    expect(rows[2]).toMatchObject({
      one_way_amount: null,
      actual_fare: true,
      travel_mode: 'bus_train',
    });
    const again = run('--apply');
    expect(again.out).toContain('0 new, 0 changed, 3 unchanged');
    expect(await count()).toBe(3);
  });
});
