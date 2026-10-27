import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDb, withTenant, DEMO_COMPANY_ID as A, U, companies, exceptions } from '../src';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const B = '01930000-0000-7000-8000-00000000000b';
const cause = (re: RegExp) => (e: unknown) =>
  re.test(String((e as { cause?: Error }).cause?.message ?? (e as Error).message));

describe.skipIf(!OWNER || !APP)('exceptions (0031)', () => {
  let owner: Pool;
  let app: Pool;
  const created: string[] = [];
  const period = '2001-01-02';

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER });
    app = new Pool({ connectionString: APP, max: 4 });
    await createDb(owner)
      .insert(companies)
      .values({ id: B, name: 'Other Pharma', slug: 'other' })
      .onConflictDoNothing();
  });
  afterAll(async () => {
    await owner.query(`delete from exceptions where period_date = $1`, [period]);
    if (created.length) await owner.query(`delete from jobs where id = any($1::uuid[])`, [created]);
    await owner.query(
      `delete from jobs where type = 'exceptions.daily' and dedupe_key like 'test:%'`,
    );
    await owner?.end();
    await app?.end();
  });

  it('migration is idempotent and recorded', () => {
    const s = readFileSync(new URL('../migrations/0031_exceptions.sql', import.meta.url), 'utf8');
    expect(s).toContain('ariforce_migrations');
    expect(s).toMatch(/CREATE TABLE IF NOT EXISTS "exceptions"/);
    expect(s).toMatch(/CREATE TABLE IF NOT EXISTS "exception_rules"/);
    expect(s).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(s).toMatch(/DROP POLICY IF EXISTS tenant_isolation ON exceptions/);
  });

  it('RLS: tenant sees only its rows; cross-tenant insert rejected', async () => {
    const db = createDb(app);
    const id = uuidv7();
    await withTenant(db, { companyId: A }, (tx) =>
      tx.insert(exceptions).values({
        id,
        companyId: A,
        userId: U.rep,
        ruleCode: 'dcr_missing',
        periodDate: period,
        severity: 'high',
      }),
    );
    const seenB = await withTenant(db, { companyId: B }, (tx) =>
      tx.execute(sql`select id from exceptions where id = ${id}`),
    );
    expect(seenB.rows).toHaveLength(0);
    const seenA = await withTenant(db, { companyId: A }, (tx) =>
      tx.execute(sql`select id from exceptions where id = ${id}`),
    );
    expect(seenA.rows).toHaveLength(1);
    await expect(
      withTenant(db, { companyId: B }, (tx) =>
        tx.insert(exceptions).values({
          companyId: A,
          userId: U.rep,
          ruleCode: 'dcr_late',
          periodDate: period,
          severity: 'low',
        }),
      ),
    ).rejects.toSatisfy(cause(/row-level security/));
    await expect(app.query(`select count(*) from exceptions`)).resolves.toBeTruthy();
    const noCtx = await app.query(`select count(*)::int as n from exceptions`);
    expect(noCtx.rows[0].n).toBe(0);
  });

  it('dedupe key (company, user, rule, period) and checks', async () => {
    const db = createDb(app);
    await expect(
      withTenant(db, { companyId: A }, (tx) =>
        tx.insert(exceptions).values({
          companyId: A,
          userId: U.rep,
          ruleCode: 'dcr_missing',
          periodDate: period,
          severity: 'high',
        }),
      ),
    ).rejects.toSatisfy(cause(/exceptions_dedupe_uq/));
    await expect(
      owner.query(
        `insert into exceptions (id, company_id, user_id, rule_code, period_date, severity, status)
         values ($1, $2, $3, 'dcr_late', $4, 'high', 'bogus')`,
        [uuidv7(), A, U.rep, period],
      ),
    ).rejects.toThrow(/exceptions_status_ck/);
    await expect(
      owner.query(
        `insert into exception_rules (id, company_id, code, severity) values ($1, $2, 'x', 'urgent')`,
        [uuidv7(), A],
      ),
    ).rejects.toThrow(/exception_rules_severity_ck/);
  });

  it('jobs_enqueue_system allows exceptions.daily; exceptions_enqueue_daily is runner-only and deduped', async () => {
    const r = await app.query(
      `select jobs_enqueue_system('exceptions.daily', '{}'::jsonb, now(), 'test:1') as id`,
    );
    expect(r.rows[0].id).toBeTruthy();
    await expect(
      app.query(`select jobs_enqueue_system('exceptions.other', '{}'::jsonb, now(), 'test:2')`),
    ).rejects.toThrow(/unknown system job type/);
    await expect(
      withTenant(createDb(app), { companyId: A }, (tx) =>
        tx.execute(sql`select exceptions_enqueue_daily()`),
      ),
    ).rejects.toSatisfy(cause(/runner-only/));
    const before = await owner.query(`select id from jobs where type = 'exceptions.evaluate'`);
    const pre = new Set(before.rows.map((x: { id: string }) => x.id));
    await app.query(`select exceptions_enqueue_daily()`);
    const second = await app.query(`select exceptions_enqueue_daily() as n`);
    expect(second.rows[0].n).toBe(0);
    const after = await owner.query(
      `select id, company_id, payload from jobs where type = 'exceptions.evaluate'`,
    );
    const mine = after.rows.filter((x: { id: string }) => !pre.has(x.id));
    created.push(...mine.map((x: { id: string }) => x.id));
    const companiesN = (
      await owner.query(`select count(*)::int as n from companies where deleted_at is null`)
    ).rows[0].n;
    // One per company per local day (fewer if an earlier run today already enqueued).
    expect(mine.length).toBeLessThanOrEqual(companiesN);
    for (const j of mine) {
      expect(j.payload).toMatchObject({ notify: true });
      expect(j.payload.from < j.payload.to).toBe(true);
    }
  });
});
