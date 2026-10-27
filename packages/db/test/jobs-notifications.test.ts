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
      `select jobs_enqueue_system('maintenance.cleanup', '{}'::jsonb, now() + interval '1 day', $1) as id`,
      [`${TAG}k1`],
    );
    const r2 = await q<{ id: string }>(
      `select jobs_enqueue_system('maintenance.cleanup', '{}'::jsonb, now() + interval '1 day', $1) as id`,
      [`${TAG}k1`],
    );
    expect(r1[0]!.id).toBeTruthy();
    expect(r2[0]!.id).toBeNull();
    await owner.query(`delete from jobs where id = $1`, [r1[0]!.id]);
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
    type C = { job_id: string; job_attempts: number; job_lock_token: string };
    let c = await q<C>(`select * from jobs_claim('wa', 50, 300)`);
    const ca = c.find((r) => r.job_id === id)!;
    expect(ca.job_attempts).toBe(1);
    expect(ca.job_lock_token).toMatch(/^wa\/[0-9a-f-]{36}$/);
    // The worker name alone is not the lock token.
    expect(
      (await q<{ s: string }>(`select jobs_fail($1, 'wa', 'x', 30) as s`, [id]))[0]!.s,
    ).toBeNull();
    const [f1] = await q<{ s: string }>(`select jobs_fail($1, $2, $3, 30) as s`, [
      id,
      ca.job_lock_token,
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
    c = await q<C>(`select * from jobs_claim('wb', 50, 300)`);
    const cb = c.find((r) => r.job_id === id)!;
    expect(cb.job_attempts).toBe(2);
    const [f2] = await q<{ s: string }>(`select jobs_fail($1, $2, 'boom', 30) as s`, [
      id,
      cb.job_lock_token,
    ]);
    expect(f2!.s).toBe('dead');
    expect((await status(id)).status).toBe('dead');

    // Stale running job is reclaimed by another worker; the old worker can no longer finish it.
    const s = await job();
    const old = (await q<C>(`select * from jobs_claim('old', 50, 300)`)).find(
      (r) => r.job_id === s,
    )!;
    await owner.query(`update jobs set locked_at = now() - interval '1 hour' where id = $1`, [s]);
    const neu = (await q<C>(`select * from jobs_claim('new', 50, 300)`)).find(
      (r) => r.job_id === s,
    )!;
    expect(neu.job_attempts).toBe(2);
    const fin = async (t: string) =>
      (await q<{ ok: boolean }>(`select jobs_finish($1, $2) as ok`, [s, t]))[0]!.ok;
    expect(await fin(old.job_lock_token)).toBe(false);
    expect(await fin('new')).toBe(false);
    expect(await fin(neu.job_lock_token)).toBe(true);
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

  describe('0030 hardening: what a normal app session can and cannot do', () => {
    type C = { job_id: string; job_company_id: string | null; job_lock_token: string };
    const db = () => createDb(app);
    const inA = <T>(f: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<T>) =>
      withTenant(db(), { companyId: A, userId: U.rep }, f);
    const rows = (r: unknown) => (r as { rows: Record<string, unknown>[] }).rows;

    it('migration 0030 is idempotent and recorded', () => {
      const s = readFileSync(
        new URL('../migrations/0030_jobs_functions_hardening.sql', import.meta.url),
        'utf8',
      );
      expect(s).toContain('ariforce_migrations');
      expect(s).toMatch(/DROP FUNCTION IF EXISTS jobs_claim/);
      expect(s).not.toMatch(/CREATE FUNCTION jobs_(finish|fail|cleanup|enqueue_system)/);
    });

    it('runner-only functions refuse to run inside a tenant (request) transaction', async () => {
      for (const stmt of [
        sql`select * from jobs_claim('x', 10, 300)`,
        sql`select * from jobs_cleanup(90, 14)`,
        sql`select jobs_enqueue_system('maintenance.cleanup', '{}'::jsonb, now(), ${`${TAG}t`})`,
      ])
        await expect(inA((tx) => tx.execute(stmt))).rejects.toSatisfy(
          cause(/runner-only function called inside a tenant transaction/),
        );
    });

    it("cannot complete/fail an unclaimed job, another worker's job, or another company's job", async () => {
      const unclaimed = await job({
        company: A,
        runAt: new Date(Date.now() + 864e5).toISOString(),
      });
      for (const t of ['', 'x', 'w/00000000-0000-0000-0000-000000000000'])
        expect(
          (await q<{ ok: boolean }>(`select jobs_finish($1, $2) as ok`, [unclaimed, t]))[0]!.ok,
        ).toBe(false);
      expect(
        (await q<{ ok: boolean }>(`select jobs_finish($1, null) as ok`, [unclaimed]))[0]!.ok,
      ).toBe(false);
      expect((await status(unclaimed)).status).toBe('queued');

      // A job of company B claimed by the runner: a company-A request session holding the token
      // still cannot finish or fail it; the runner (no tenant) can.
      const bj = await job({ company: B });
      const claimed = (await q<C>(`select * from jobs_claim('wz', 100, 300)`)).find(
        (r) => r.job_id === bj,
      )!;
      expect(claimed.job_company_id).toBe(B);
      const f = await inA((tx) =>
        tx.execute(sql`select jobs_finish(${bj}::uuid, ${claimed.job_lock_token}) as ok`),
      );
      expect(rows(f)[0]!.ok).toBe(false);
      const fl = await inA((tx) =>
        tx.execute(sql`select jobs_fail(${bj}::uuid, ${claimed.job_lock_token}, 'x', 0) as s`),
      );
      expect(rows(fl)[0]!.s).toBeNull();
      expect((await status(bj)).status).toBe('running');
      expect(
        (
          await q<{ ok: boolean }>(`select jobs_finish($1, $2) as ok`, [bj, claimed.job_lock_token])
        )[0]!.ok,
      ).toBe(true);
      // Close out anything else this batch claimed so later tests start clean.
      await owner.query(
        `update jobs set status = 'done' where locked_by like 'wz/%' and status = 'running'`,
      );
    });

    it('cannot enqueue for another company or arbitrary system jobs', async () => {
      await expect(
        inA((tx) =>
          tx.execute(
            sql`insert into jobs (id, company_id, type) values (${uuidv7()}, ${B}, ${`${TAG}.x`})`,
          ),
        ),
      ).rejects.toSatisfy(cause(/row-level security/));
      // System jobs (company NULL) cannot be inserted directly either.
      await expect(
        inA((tx) =>
          tx.execute(sql`insert into jobs (id, company_id, type) values (${uuidv7()}, null, 'x')`),
        ),
      ).rejects.toSatisfy(cause(/row-level security/));
      await expect(
        q(`select jobs_enqueue_system($1, '{}'::jsonb, now(), $2)`, [`${TAG}.evil`, `${TAG}e`]),
      ).rejects.toThrow(/unknown system job type/);
      await expect(
        q(`select jobs_enqueue_system('maintenance.cleanup', $1::jsonb, now(), $2)`, [
          JSON.stringify({ pad: 'x'.repeat(5000) }),
          `${TAG}big`,
        ]),
      ).rejects.toThrow(/payload too large/);
      const far = await q<{ id: string }>(
        `select jobs_enqueue_system('maintenance.cleanup', '{}'::jsonb, now() + interval '1 year', $1) as id`,
        [`${TAG}far`],
      );
      const row = await status(far[0]!.id);
      expect(new Date(row.run_at).getTime()).toBeLessThan(Date.now() + 8 * 864e5);
      await owner.query(`delete from jobs where id = $1`, [far[0]!.id]);
    });

    it('cleanup floors: never deletes read notifications < 30 days or done jobs < 1 day', async () => {
      const ins = `insert into notifications (id, company_id, user_id, type, title, body, dedupe_key, read_at)
        values ($1, $2, $3, 'leave.approved', 't', 'b', $4, now() - make_interval(days => $5::int))`;
      const young = uuidv7();
      const old = uuidv7();
      await owner.query(ins, [young, A, U.rep, `${TAG}:floor-young`, 29]);
      await owner.query(ins, [old, B, U.rep, `${TAG}:floor-old`, 31]);
      const fresh = await job();
      const dayOld = await job();
      await owner.query(`update jobs set status = 'done' where id = $1`, [fresh]);
      await owner.query(
        `update jobs set status = 'done', updated_at = now() - interval '25 hours' where id = $1`,
        [dayOld],
      );
      await q(`select * from jobs_cleanup(0, -5)`);
      const n = (
        await owner.query(`select id from notifications where id = any($1)`, [[young, old]])
      ).rows.map((r) => r.id);
      expect(n).toEqual([young]);
      const j = (
        await owner.query(`select id from jobs where id = any($1)`, [[fresh, dayOld]])
      ).rows.map((r) => r.id);
      expect(j).toEqual([fresh]);
      await q(`select * from jobs_cleanup(null, null)`); // defaults, no error
    });
  });
});
