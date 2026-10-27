import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDb, withTenant, DEMO_COMPANY_ID as A, U, companies, notifications } from '../src';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const B = '01930000-0000-7000-8000-00000000000b';
const TAG = `t${Date.now()}`;
/** drizzle wraps pg errors; match the driver message. */
const cause = (re: RegExp) => (e: unknown) =>
  re.test(String((e as { cause?: Error }).cause?.message ?? (e as Error).message));

describe.skipIf(!OWNER || !APP)('jobs + notifications (0028)', () => {
  let owner: Pool;
  let app: Pool;
  const q = async <T = Record<string, unknown>>(text: string, v: unknown[] = []) =>
    (await app.query(text, v)).rows as T[];
  const job = async (o: Record<string, unknown> = {}) => {
    const id = uuidv7();
    await owner.query(
      `insert into jobs (id, company_id, type, payload, max_attempts, dedupe_key, run_at)
       values ($1, $2, $3, '{}', $4, $5, coalesce($6::timestamptz, now()))`,
      [id, o.company ?? A, o.type ?? `${TAG}.x`, o.max ?? 5, o.dedupe ?? null, o.runAt ?? null],
    );
    return id;
  };
  const status = async (id: string) =>
    (await owner.query(`select * from jobs where id = $1`, [id])).rows[0];

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER });
    app = new Pool({ connectionString: APP, max: 8 });
    await createDb(owner)
      .insert(companies)
      .values({ id: B, name: 'Other Pharma', slug: 'other' })
      .onConflictDoNothing();
    // Keep other queued jobs (from earlier runs on this DB) out of the claim tests.
    await owner.query(`update jobs set run_at = now() + interval '1 day' where status = 'queued'`);
  });
  afterAll(async () => {
    await owner.query(`delete from jobs where type like $1`, [`${TAG}%`]);
    await owner?.end();
    await app?.end();
  });

  it('migration is idempotent and recorded', () => {
    const s = readFileSync(
      new URL('../migrations/0028_notifications_jobs.sql', import.meta.url),
      'utf8',
    );
    expect(s).toContain('ariforce_migrations');
    expect(s).toMatch(/CREATE TABLE IF NOT EXISTS "jobs"/);
    expect(s).toMatch(/DROP POLICY IF EXISTS/);
    expect(s).toMatch(/SECURITY DEFINER/);
  });

  it('dedupe: same (type, dedupe_key) enqueues once', async () => {
    const r1 = await q<{ id: string }>(
      `select jobs_enqueue_system($1, '{}'::jsonb, now() + interval '1 day', 'k1') as id`,
      [`${TAG}.sys`],
    );
    const r2 = await q<{ id: string }>(
      `select jobs_enqueue_system($1, '{}'::jsonb, now() + interval '1 day', 'k1') as id`,
      [`${TAG}.sys`],
    );
    expect(r1[0]!.id).toBeTruthy();
    expect(r2[0]!.id).toBeNull();
    await expect(job({ dedupe: 'd1' })).resolves.toBeTruthy();
    await expect(job({ dedupe: 'd1' })).rejects.toThrow(/duplicate key/);
  });

  it('claim concurrency: parallel workers never get the same job', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 30; i++) ids.add(await job());
    const batches = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((w) =>
        q<{ job_id: string }>(`select * from jobs_claim($1, 10, 300)`, [`w${w}`]),
      ),
    );
    const got = batches
      .flat()
      .map((r) => r.job_id)
      .filter((id) => ids.has(id));
    expect(new Set(got).size).toBe(got.length);
    expect(got.length).toBe(30);
    await owner.query(`update jobs set status = 'done' where id = any($1)`, [[...ids]]);
  });

  it('retry with backoff, then dead; stale reclaim; finish needs the lock owner', async () => {
    const id = await job({ max: 2 });
    let c = await q<{ job_id: string; job_attempts: number }>(
      `select * from jobs_claim('wa', 50, 300)`,
    );
    expect(c.find((r) => r.job_id === id)?.job_attempts).toBe(1);
    const [f1] = await q<{ s: string }>(`select jobs_fail($1, 'wa', $2, 30) as s`, [
      id,
      'x'.repeat(900),
    ]);
    expect(f1!.s).toBe('queued');
    let row = await status(id);
    expect(row.last_error.length).toBe(500);
    expect(new Date(row.run_at).getTime() - Date.now()).toBeGreaterThan(20_000);
    expect((await q(`select * from jobs_claim('wa', 50, 300)`)).some((r) => r.job_id === id)).toBe(
      false,
    );
    await owner.query(`update jobs set run_at = now() where id = $1`, [id]);
    c = await q(`select * from jobs_claim('wb', 50, 300)`);
    expect(c.find((r) => r.job_id === id)?.job_attempts).toBe(2);
    const [f2] = await q<{ s: string }>(`select jobs_fail($1, 'wb', 'boom', 30) as s`, [id]);
    expect(f2!.s).toBe('dead');
    expect((await status(id)).status).toBe('dead');

    // Stale running job is reclaimed by another worker; the old worker can no longer finish it.
    const s = await job();
    await q(`select * from jobs_claim('old', 50, 300)`);
    await owner.query(`update jobs set locked_at = now() - interval '1 hour' where id = $1`, [s]);
    c = await q(`select * from jobs_claim('new', 50, 300)`);
    expect(c.find((r) => r.job_id === s)?.job_attempts).toBe(2);
    expect((await q<{ ok: boolean }>(`select jobs_finish($1, 'old') as ok`, [s]))[0]!.ok).toBe(
      false,
    );
    expect((await q<{ ok: boolean }>(`select jobs_finish($1, 'new') as ok`, [s]))[0]!.ok).toBe(
      true,
    );
    row = await status(s);
    expect(row.status).toBe('done');
  });

  it('cleanup removes old read notifications and old done jobs only', async () => {
    const mk = async (readDays: number | null, key: string) => {
      const id = uuidv7();
      await owner.query(
        `insert into notifications (id, company_id, user_id, type, title, body, dedupe_key, read_at)
         values ($1, $2, $3, 'leave.approved', 't', 'b', $4, case when $5::int is null then null else now() - make_interval(days => $5::int) end)`,
        [id, A, U.rep, `${TAG}:${key}`, readDays],
      );
      return id;
    };
    const oldRead = await mk(100, 'old');
    const newRead = await mk(10, 'new');
    const unread = await mk(null, 'unread');
    const oldDone = await job();
    const newDone = await job();
    await owner.query(
      `update jobs set status = 'done', updated_at = now() - interval '20 days' where id = $1`,
      [oldDone],
    );
    await owner.query(`update jobs set status = 'done' where id = $1`, [newDone]);
    await q(`select * from jobs_cleanup(90, 14)`);
    const left = (
      await owner.query(`select id from notifications where id = any($1)`, [
        [oldRead, newRead, unread],
      ])
    ).rows.map((r) => r.id);
    expect(left.sort()).toEqual([newRead, unread].sort());
    const jl = (
      await owner.query(`select id from jobs where id = any($1)`, [[oldDone, newDone]])
    ).rows.map((r) => r.id);
    expect(jl).toEqual([newDone]);
  });

  it('RLS: own notifications only, within the company', async () => {
    const mine = uuidv7();
    const theirs = uuidv7();
    const otherCo = uuidv7();
    const ins = `insert into notifications (id, company_id, user_id, type, title, body, dedupe_key) values ($1, $2, $3, 'leave.approved', 't', 'b', $4)`;
    await owner.query(ins, [mine, A, U.rep, `${TAG}:m`]);
    await owner.query(ins, [theirs, A, U.otherRep, `${TAG}:t`]);
    await owner.query(ins, [otherCo, B, U.rep, `${TAG}:o`]);
    const db = createDb(app);
    const seen = await withTenant(db, { companyId: A, userId: U.rep }, (tx) =>
      tx.select({ id: notifications.id }).from(notifications),
    );
    const ids = seen.map((r) => r.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
    expect(ids).not.toContain(otherCo);
    const upd = await withTenant(db, { companyId: A, userId: U.rep }, (tx) =>
      tx.execute(sql`update notifications set read_at = now() where id in (${theirs}, ${otherCo})`),
    );
    expect(upd.rowCount).toBe(0);
    // Without a user, nothing is readable (the runner inserts but never reads).
    const none = await withTenant(db, { companyId: A }, (tx) =>
      tx.select({ id: notifications.id }).from(notifications),
    );
    expect(none).toHaveLength(0);
    // Insert into another company is refused.
    await expect(
      withTenant(db, { companyId: A, userId: U.rep }, (tx) =>
        tx.execute(
          sql`insert into notifications (id, company_id, user_id, type, title, body, dedupe_key) values (${uuidv7()}, ${B}, ${U.rep}, 'x', 't', 'b', ${`${TAG}:bad`})`,
        ),
      ),
    ).rejects.toSatisfy(cause(/row-level security/));
    // Only read_at is updatable by the app role.
    await expect(
      withTenant(db, { companyId: A, userId: U.rep }, (tx) =>
        tx.execute(sql`update notifications set title = 'x' where id = ${mine}`),
      ),
    ).rejects.toSatisfy(cause(/permission denied/));
    // Jobs: tenant isolated; app role cannot update or delete directly.
    const bj = await job({ company: B, runAt: new Date(Date.now() + 86_400_000).toISOString() });
    const vis = await withTenant(db, { companyId: A }, (tx) =>
      tx.execute(sql`select id from jobs where id = ${bj}`),
    );
    expect(vis.rows).toHaveLength(0);
    await expect(app.query(`delete from jobs where id = $1`, [bj])).rejects.toThrow(
      /permission denied/,
    );
    await owner.query(`delete from notifications where dedupe_key like $1`, [`${TAG}%`]);
  });
});
