import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createDb,
  withTenant,
  DEMO_COMPANY_ID as A,
  T,
  allowancePlaces,
  allowanceRates,
  companies,
} from '../src';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const B = '01930000-0000-7000-8000-00000000000b';
const cause = (re: RegExp) => (e: unknown) =>
  re.test(String((e as { cause?: Error }).cause?.message ?? (e as Error).message));

describe.skipIf(!OWNER || !APP)('TA/DA allowances (0034)', () => {
  let owner: Pool;
  let app: Pool;
  const eff = '1901-01-01';
  const place = `Test town ${Date.now()}`;

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER });
    app = new Pool({ connectionString: APP, max: 4 });
    await createDb(owner)
      .insert(companies)
      .values({ id: B, name: 'Other Pharma', slug: 'other' })
      .onConflictDoNothing();
  });
  afterAll(async () => {
    await owner.query(`delete from allowance_rates where effective_from = $1`, [eff]);
    await owner.query(`delete from allowance_places where name like 'Test town %'`);
    await owner?.end();
    await app?.end();
  });

  it('migration is idempotent and recorded', () => {
    const s = readFileSync(
      new URL('../migrations/0034_tada_allowances.sql', import.meta.url),
      'utf8',
    );
    expect(s).toContain('ariforce_migrations');
    expect(s).toMatch(/CREATE TABLE IF NOT EXISTS "allowance_rates"/);
    expect(s).toMatch(/CREATE TABLE IF NOT EXISTS "allowance_places"/);
    expect(s).toMatch(/ADD COLUMN IF NOT EXISTS "source"/);
    expect(s).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(s).toMatch(/DROP CONSTRAINT IF EXISTS expense_lines_category_ck/);
  });

  it('RLS isolates tenants; checks and partial unique indexes hold', async () => {
    const db = createDb(app);
    const id = uuidv7();
    await withTenant(db, { companyId: A }, (tx) =>
      tx.insert(allowanceRates).values({ id, companyId: A, band: 'hq', effectiveFrom: eff }),
    );
    const seenB = await withTenant(db, { companyId: B }, (tx) =>
      tx.execute(sql`select id from allowance_rates where id = ${id}`),
    );
    expect(seenB.rows).toHaveLength(0);
    await expect(
      withTenant(db, { companyId: B }, (tx) =>
        tx.insert(allowanceRates).values({ companyId: A, band: 'ex_hq', effectiveFrom: eff }),
      ),
    ).rejects.toSatisfy(cause(/row-level security/));
    // Same band/all-roles/date twice: unique; after soft delete a new row is allowed.
    await expect(
      withTenant(db, { companyId: A }, (tx) =>
        tx.insert(allowanceRates).values({ companyId: A, band: 'hq', effectiveFrom: eff }),
      ),
    ).rejects.toSatisfy(cause(/allowance_rates_uq/));
    await owner.query(`update allowance_rates set deleted_at = now() where id = $1`, [id]);
    await withTenant(db, { companyId: A }, (tx) =>
      tx.insert(allowanceRates).values({ companyId: A, band: 'hq', effectiveFrom: eff }),
    );
    await expect(
      owner.query(
        `insert into allowance_rates (id, company_id, band, effective_from, da_amount) values ($1, $2, 'hq', $3, -1)`,
        [uuidv7(), A, '1901-01-02'],
      ),
    ).rejects.toThrow(/allowance_rates_amounts_ck/);

    await withTenant(db, { companyId: A }, (tx) =>
      tx
        .insert(allowancePlaces)
        .values({ companyId: A, hqTerritoryId: T.hq, name: place, band: 'ex_hq', oneWayKm: '40' }),
    );
    await expect(
      withTenant(db, { companyId: A }, (tx) =>
        tx.insert(allowancePlaces).values({
          companyId: A,
          hqTerritoryId: T.hq,
          name: place.toUpperCase(),
          band: 'outstation',
          oneWayKm: '40',
        }),
      ),
    ).rejects.toSatisfy(cause(/allowance_places_uq/));
    await expect(
      owner.query(
        `insert into allowance_places (id, company_id, hq_territory_id, name, band, one_way_km) values ($1, $2, $3, 'Test town x', 'hq', 5)`,
        [uuidv7(), A, T.hq],
      ),
    ).rejects.toThrow(/allowance_places_band_ck/);
  });

  it('expense_lines: allowance category allowed, unknown source rejected', async () => {
    const r = await owner.query(
      `select pg_get_constraintdef(oid) as d from pg_constraint where conname in ('expense_lines_category_ck','expense_lines_source_ck') order by conname`,
    );
    expect(r.rows[0].d).toContain('allowance');
    expect(r.rows[1].d).toContain('auto');
  });
});
