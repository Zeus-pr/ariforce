import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  withTenant,
  DEMO_COMPANY_ID as A,
  T,
  auditLog,
  companies,
  doctors,
  territories,
} from '../src';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const B = '01930000-0000-7000-8000-00000000000b';
const B_TERR = '01930000-0000-7000-8000-0000000b0001';
const B_DOC = '01930000-0000-7000-8000-0000000b0002';

describe.skipIf(!OWNER || !APP)('Postgres RLS tenant isolation (app role, non-superuser)', () => {
  let owner: Pool;
  let app: Pool;
  const db = () => createDb(app);

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER });
    app = new Pool({ connectionString: APP });
    const o = createDb(owner);
    await o
      .insert(companies)
      .values({ id: B, name: 'Other Pharma', slug: 'other' })
      .onConflictDoNothing();
    await o
      .insert(territories)
      .values({
        id: B_TERR,
        companyId: B,
        level: 'national',
        code: 'IN',
        name: 'India',
        path: B_TERR,
      })
      .onConflictDoNothing();
    await o
      .insert(doctors)
      .values({ id: B_DOC, companyId: B, territoryId: B_TERR, name: 'Dr. Other' })
      .onConflictDoNothing();
  });
  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  it('app role is not superuser and cannot bypass RLS', async () => {
    const r = await app.query(
      `select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('sees nothing without a tenant context', async () => {
    const rows = await db().select().from(doctors);
    expect(rows).toHaveLength(0);
  });

  it('reads only its own company rows', async () => {
    const rows = await withTenant(db(), { companyId: A }, (tx) => tx.select().from(doctors));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.companyId === A)).toBe(true);
    const other = await withTenant(db(), { companyId: A }, (tx) =>
      tx.select().from(doctors).where(eq(doctors.id, B_DOC)),
    );
    expect(other).toHaveLength(0);
  });

  it('cannot insert a row for another company', async () => {
    await expect(
      withTenant(db(), { companyId: A }, (tx) =>
        tx.insert(doctors).values({ companyId: B, territoryId: B_TERR, name: 'Injected' }),
      ),
    ).rejects.toThrow();
  });

  it('cannot update or delete another company rows (0 rows affected)', async () => {
    const upd = await withTenant(db(), { companyId: A }, (tx) =>
      tx.update(doctors).set({ name: 'Hacked' }).where(eq(doctors.id, B_DOC)).returning(),
    );
    expect(upd).toHaveLength(0);
    const del = await withTenant(db(), { companyId: A }, (tx) =>
      tx.delete(doctors).where(eq(doctors.id, B_DOC)).returning(),
    );
    expect(del).toHaveLength(0);
  });

  it('cannot move a row to another company', async () => {
    await withTenant(db(), { companyId: A }, async (tx) => {
      const [d] = await tx
        .update(doctors)
        .set({ companyId: B })
        .where(eq(doctors.territoryId, T.hq))
        .returning();
      expect(d?.companyId).toBe(A); // trigger pins company_id
    });
  });

  it('bumps version and updated_at on update', async () => {
    await withTenant(db(), { companyId: A }, async (tx) => {
      const [before] = await tx.select().from(doctors).where(eq(doctors.territoryId, T.hq));
      const [after] = await tx
        .update(doctors)
        .set({ phone: '9999999999' })
        .where(eq(doctors.id, before!.id))
        .returning();
      expect(after!.version).toBe(before!.version + 1);
    });
  });

  it('audit_log is append-only', async () => {
    await withTenant(db(), { companyId: A }, (tx) =>
      tx.insert(auditLog).values({ companyId: A, action: 'test.append' }),
    );
    await expect(
      withTenant(db(), { companyId: A }, (tx) =>
        tx.update(auditLog).set({ action: 'x' }).where(eq(auditLog.companyId, A)),
      ),
    ).rejects.toThrow();
    await expect(withTenant(db(), { companyId: A }, (tx) => tx.delete(auditLog))).rejects.toThrow();
    // Even the owner cannot rewrite history (trigger).
    await expect(owner.query(`delete from audit_log`)).rejects.toThrow(/append-only/);
    await expect(
      withTenant(db(), { companyId: A }, (tx) =>
        tx.insert(auditLog).values({ companyId: B, action: 'forged' }),
      ),
    ).rejects.toThrow();
  });

  it('every tenant table has company_id NOT NULL and forced RLS', async () => {
    const r = await owner.query(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity,
             (select attnotnull from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id') as cid
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('spatial_ref_sys','companies','ariforce_migrations')
        and c.relname not like 'auth\\_%'`);
    for (const row of r.rows) {
      expect(row, row.relname).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
        cid: true,
      });
    }
  });
});
