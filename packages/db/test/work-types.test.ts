import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_WORK_TYPES } from '../src';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const here = import.meta.dirname;
const DRIZZLE = readFileSync(resolve(here, '../drizzle/0026_work_types_defaults.sql'), 'utf8');
const FILE = readFileSync(resolve(here, '../migrations/0026_work_types_defaults.sql'), 'utf8');
const INSERT = DRIZZLE.split('--> statement-breakpoint')[0]!;

describe('0026 work types defaults (static)', () => {
  it('SQL VALUES match DEFAULT_WORK_TYPES exactly', () => {
    const rows = [
      ...INSERT.matchAll(
        /\('([A-Z_]+)',\s*'([^']+)',\s*'(\w+)',\s*(true|false),\s*'(\w+)',\s*(true|false)\)/g,
      ),
    ].map((m) => ({
      code: m[1],
      name: m[2],
      kind: m[3],
      countsAsFieldDay: m[4] === 'true',
      allowanceBand: m[5],
      requiresLocation: m[6] === 'true',
    }));
    expect(rows).toEqual(DEFAULT_WORK_TYPES.map((w) => ({ ...w })));
    expect(DEFAULT_WORK_TYPES.map((w) => w.code)).toEqual([
      'FIELD_HQ',
      'FIELD_EXHQ',
      'FIELD_OUT',
      'MEETING',
      'TRAINING',
      'OFFICE',
      'LEAVE',
      'HOLIDAY',
    ]);
    expect(INSERT).toContain('ON CONFLICT (company_id, code) DO NOTHING');
  });
});

describe.skipIf(!OWNER || !APP)('0026 work types defaults (database)', () => {
  let owner: Pool;
  let app: Pool;
  const empty = randomUUID();
  const partial = randomUUID();
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER });
    app = new Pool({ connectionString: APP });
    await owner.query(
      `insert into companies (id, name, slug) values ($1, 'WT empty', $2), ($3, 'WT partial', $4)`,
      [empty, `wt-empty-${tag}`, partial, `wt-partial-${tag}`],
    );
    // Like prod 'arighna': rows already present (here: one, with a custom label) must stay untouched.
    await owner.query(
      `insert into work_types (id, company_id, code, name, kind, counts_as_field_day, allowance_band, requires_location)
       values ($1, $2, 'FIELD_HQ', 'HQ work (custom)', 'field', true, 'hq', true)`,
      [randomUUID(), partial],
    );
  });
  afterAll(async () => {
    // Retire only what this suite created (soft delete; FK from work_types).
    await owner?.query(`update companies set deleted_at = now() where id = any($1)`, [
      [empty, partial],
    ]);
    await owner?.end();
    await app?.end();
  });

  const count = async (c: string) =>
    Number(
      (await owner.query(`select count(*) from work_types where company_id = $1`, [c])).rows[0]
        .count,
    );
  const missing = async () =>
    (
      await app.query<{ company_id: string; slug: string }>(
        'select * from companies_without_work_types()',
      )
    ).rows.map((r) => r.company_id);

  it('health helper sees the empty company (app role, no tenant context)', async () => {
    const m = await missing();
    expect(m).toContain(empty);
    expect(m).not.toContain(partial);
  });

  it('insert is idempotent and keeps existing rows; the guarded file is re-runnable', async () => {
    await owner.query(INSERT);
    await owner.query(INSERT);
    expect(await count(empty)).toBe(8);
    expect(await count(partial)).toBe(8);
    const hq = await owner.query(
      `select name from work_types where company_id = $1 and code = 'FIELD_HQ'`,
      [partial],
    );
    expect(hq.rows[0].name).toBe('HQ work (custom)');
    const codes = (
      await owner.query(`select code from work_types where company_id = $1 order by code`, [empty])
    ).rows.map((r) => r.code);
    expect(codes).toEqual([...DEFAULT_WORK_TYPES.map((w) => w.code)].sort());
    // Applied already by migrate on this DB: running the generated file twice is a recorded no-op.
    await owner.query(FILE);
    await owner.query(FILE);
    const rec = await owner.query(
      `select count(*) from ariforce_migrations where name = '0026_work_types_defaults'`,
    );
    expect(Number(rec.rows[0].count)).toBe(1);
    expect(await missing()).not.toContain(empty);
  });

  it('every live company has the standard codes after migrate + seed', async () => {
    const r = await owner.query(
      `select c.slug from companies c where c.deleted_at is null and c.slug = 'demo'
         and (select count(*) from work_types w where w.company_id = c.id and w.code = any($1)) = 8`,
      [DEFAULT_WORK_TYPES.map((w) => w.code)],
    );
    expect(r.rowCount).toBe(1);
  });
});
