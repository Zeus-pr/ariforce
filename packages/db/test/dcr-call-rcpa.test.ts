import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDb, withTenant, DEMO_COMPANY_ID as A, U, companies, dcrCallRcpa } from '../src';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const B = '01930000-0000-7000-8000-00000000000b';
const TAG = `rcpa${Date.now()}`;
const cause = (re: RegExp) => (e: unknown) =>
  re.test(String((e as { cause?: Error }).cause?.message ?? (e as Error).message));

describe.skipIf(!OWNER || !APP)('dcr_call_rcpa (0029)', () => {
  let owner: Pool;
  let app: Pool;
  let callId: string;
  let productId: string;
  const one = async (text: string, v: unknown[] = []) => (await owner.query(text, v)).rows[0];
  const line = (o: Record<string, unknown> = {}) =>
    owner.query(
      `insert into dcr_call_rcpa (id, company_id, call_id, product_id, competitor_brand, competitor_company, quantity, prescriptions)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        o.id ?? uuidv7(),
        o.company ?? A,
        callId,
        productId,
        o.brand ?? null,
        o.co ?? null,
        o.qty ?? 5,
        o.rx ?? null,
      ],
    );

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER });
    app = new Pool({ connectionString: APP, max: 4 });
    await createDb(owner)
      .insert(companies)
      .values({ id: B, name: 'Other Pharma', slug: 'other' })
      .onConflictDoNothing();
    const wt = await one(`select id from work_types where company_id = $1 limit 1`, [A]);
    const div = { id: uuidv7() };
    await owner.query(
      `insert into divisions (id, company_id, code, name) values ($1, $2, $3, 'Rcpa div')`,
      [div.id, A, TAG],
    );
    const chem = await one(`select id from chemists where company_id = $1 limit 1`, [A]);
    productId = uuidv7();
    await owner.query(
      `insert into products (id, company_id, division_id, code, name) values ($1, $2, $3, $4, 'Rcpa test')`,
      [productId, A, div.id, TAG],
    );
    const dcrId = uuidv7();
    // A date far in the past keeps this fixture away from API test days.
    await owner.query(
      `insert into dcrs (id, company_id, user_id, date, work_type_id) values ($1, $2, $3, '2001-01-01', $4)`,
      [dcrId, A, U.rep, wt.id],
    );
    callId = uuidv7();
    await owner.query(
      `insert into dcr_calls (id, company_id, dcr_id, user_id, date, outlet_kind, outlet_id)
       values ($1, $2, $3, $4, '2001-01-01', 'chemist', $5)`,
      [callId, A, dcrId, U.rep, chem.id],
    );
  });
  afterAll(async () => {
    await owner?.end();
    await app?.end();
  });

  it('migration is idempotent and recorded', () => {
    const s = readFileSync(
      new URL('../migrations/0029_dcr_call_rcpa.sql', import.meta.url),
      'utf8',
    );
    expect(s).toContain('ariforce_migrations');
    expect(s).toMatch(/CREATE TABLE IF NOT EXISTS "dcr_call_rcpa"/);
    expect(s).toMatch(/DROP POLICY IF EXISTS tenant_isolation ON dcr_call_rcpa/);
    expect(s).toMatch(/EXCEPTION WHEN duplicate_object/);
  });

  it('constraints: quantity > 0, rx >= 0, company only with brand, brand length', async () => {
    await expect(line({ qty: 0 })).rejects.toThrow(/dcr_call_rcpa_quantity_ck/);
    await expect(line({ rx: -1 })).rejects.toThrow(/dcr_call_rcpa_rx_ck/);
    await expect(line({ co: 'Acme' })).rejects.toThrow(/dcr_call_rcpa_brand_ck/);
    await expect(line({ brand: '' })).rejects.toThrow(/dcr_call_rcpa_brand_ck/);
    await expect(line({ brand: 'x'.repeat(101) })).rejects.toThrow(/dcr_call_rcpa_brand_ck/);
  });

  it('one live row per (call, product, brand), case-insensitive; soft-deleted rows free the slot', async () => {
    const first = uuidv7();
    await line({ id: first, brand: 'Dolo 650', co: 'Micro' });
    await expect(line({ brand: 'DOLO 650' })).rejects.toThrow(/dcr_call_rcpa_line_uq/);
    await line({}); // own-brand row
    await expect(line({})).rejects.toThrow(/dcr_call_rcpa_line_uq/);
    await owner.query(`update dcr_call_rcpa set deleted_at = now() where call_id = $1`, [callId]);
    await line({ brand: 'dolo 650', qty: 7, rx: 2 });
    const v = await one(`select version from dcr_call_rcpa where id = $1`, [first]);
    expect(v.version).toBe(2); // set_row_meta trigger bumps version
  });

  it('RLS: company isolation for the app role', async () => {
    const db = createDb(app);
    const seen = await withTenant(db, { companyId: A, userId: U.rep }, (tx) =>
      tx.select({ id: dcrCallRcpa.id }).from(dcrCallRcpa),
    );
    expect(seen.length).toBeGreaterThan(0);
    const other = await withTenant(db, { companyId: B, userId: U.rep }, (tx) =>
      tx.select({ id: dcrCallRcpa.id }).from(dcrCallRcpa),
    );
    expect(other).toHaveLength(0);
    const upd = await withTenant(db, { companyId: B }, (tx) =>
      tx.execute(sql`update dcr_call_rcpa set quantity = 99 where call_id = ${callId}`),
    );
    expect(upd.rowCount).toBe(0);
    await expect(
      withTenant(db, { companyId: B }, (tx) =>
        tx.execute(
          sql`insert into dcr_call_rcpa (id, company_id, call_id, product_id, quantity) values (${uuidv7()}, ${A}, ${callId}, ${productId}, 1)`,
        ),
      ),
    ).rejects.toSatisfy(cause(/row-level security/));
    await expect(
      withTenant(db, { companyId: A }, (tx) =>
        tx.execute(sql`delete from dcr_call_rcpa where call_id = ${callId}`),
      ),
    ).rejects.toSatisfy(cause(/permission denied/));
  });
});
