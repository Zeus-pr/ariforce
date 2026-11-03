import type request from 'supertest';

type Http = () => ReturnType<typeof request>;

/** First visible product; imports a division + product as the director when the seed has none. */
export async function ensureProduct(http: Http, bm: string, director: string): Promise<string> {
  const first = await http().get('/v1/products?limit=1').set({ authorization: bm });
  if (first.body.items?.length) return first.body.items[0].id;
  const run = Date.now().toString(36).toUpperCase();
  await http()
    .post('/v1/divisions/import')
    .set({ authorization: director })
    .send({ dryRun: false, rows: [{ code: `DV${run}`, name: `Division ${run}`, active: 'Y' }] });
  const imp = await http()
    .post('/v1/products/import')
    .set({ authorization: director })
    .send({
      dryRun: false,
      rows: [{ code: `PX${run}`, name: 'Test product', division_code: `DV${run}` }],
    });
  if (imp.status >= 300) throw new Error(`product import failed: ${JSON.stringify(imp.body)}`);
  const again = await http().get(`/v1/products?q=PX${run}`).set({ authorization: director });
  return again.body.items[0].id;
}

/** A fresh product (in the first product's division) with the given PTR / active flag (#40). */
export async function createProduct(
  http: Http,
  bm: string,
  director: string,
  o: { ptr?: number | null; pts?: number | null; active?: boolean; admin?: string } = {},
): Promise<string> {
  const base = await ensureProduct(http, bm, director);
  const div = (await http().get(`/v1/products/${base}`).set({ authorization: director })).body
    .divisionId;
  const code = `PR${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const res = await http()
    .post('/v1/products')
    .set({ authorization: director })
    .send({
      divisionId: div,
      code,
      name: `Product ${code}`,
      brand: null,
      composition: null,
      packSize: null,
      form: null,
      mrp: null,
      ptr: o.ptr ?? null,
      pts: o.pts ?? null,
      isSample: false,
      active: o.active ?? true,
    });
  if (res.status !== 201) throw new Error(`product create failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

/** Seed personas whose only role is retired (distribution_head / accountant): sign-in is refused. */
export const RETIRED_PERSONAS = new Set(['dh', 'accountant']);

/**
 * Bearer token for a seed persona (`who`@demo.ariforce.in). Retired-role personas cannot sign in any
 * more (403 ROLE_RETIRED), so for them a session row is written directly as the DB owner; this
 * keeps coverage of what such a (pre-existing) session may still do.
 */
export async function bearerFor(http: Http, who: string, password: string): Promise<string> {
  const email = `${who}@demo.ariforce.in`;
  if (!RETIRED_PERSONAS.has(who)) {
    const res = await http().post('/v1/auth/sign-in/email').send({ email, password });
    return `Bearer ${res.headers['set-auth-token']}`;
  }
  const { Pool } = await import('pg');
  const { randomBytes, randomUUID } = await import('node:crypto');
  const pool = new Pool({ connectionString: process.env.DIRECT_URL, max: 1 });
  try {
    const token = randomBytes(24).toString('hex');
    const r = await pool.query(
      `insert into auth_session (id, token, user_id, expires_at)
       select $1, $2, id, now() + interval '1 day' from auth_user where email = $3 returning id`,
      [randomUUID(), token, email],
    );
    if (!r.rowCount) throw new Error(`no auth user for ${email}`);
    return `Bearer ${token}`;
  } finally {
    await pool.end();
  }
}

/**
 * A holder of a retired role with no login (the production shape: invited, never accepted). The API
 * can no longer create one, so the row is written as the DB owner in the demo company, with a
 * pending invite. Returns the users.id and the raw invite token.
 */
export async function insertRetiredHolder(
  email: string,
  role: 'distribution_head' | 'accountant',
  opts: { territoryId?: string; managerId?: string } = {},
): Promise<{ id: string; token: string }> {
  const { Pool } = await import('pg');
  const { createHash, randomBytes } = await import('node:crypto');
  const token = randomBytes(32).toString('base64url');
  const pool = new Pool({ connectionString: process.env.DIRECT_URL, max: 1 });
  try {
    const u = await pool.query(
      `insert into users (id, company_id, email, name, status, manager_id)
       select gen_random_uuid(), c.id, $1, $2, 'invited', $3 from companies c where c.slug = 'demo' returning id, company_id`,
      [email, `Retired ${role}`, opts.managerId ?? null],
    );
    const { id, company_id: c } = u.rows[0];
    await pool.query(
      `insert into user_roles (company_id, user_id, role_id)
       select $1, $2, r.id from roles r where r.company_id = $1 and r.key = $3`,
      [c, id, role],
    );
    if (opts.territoryId)
      await pool.query(
        `insert into user_territories (company_id, user_id, territory_id) values ($1, $2, $3)`,
        [c, id, opts.territoryId],
      );
    await pool.query(
      `insert into user_invites (id, company_id, user_id, token_hash, expires_at)
       values (gen_random_uuid(), $1, $2, $3, now() + interval '7 days')`,
      [c, id, createHash('sha256').update(token).digest('hex')],
    );
    return { id, token };
  } finally {
    await pool.end();
  }
}

/**
 * A fresh active staff member with a login, written as the DB owner in the demo company (role,
 * manager and territories as given) plus a ready session. For reporting-line shapes the seed lacks.
 */
export async function insertStaff(
  email: string,
  role: string,
  managerId: string | null,
  territoryIds: string[] = [],
): Promise<{ id: string; bearer: string }> {
  const { Pool } = await import('pg');
  const { randomBytes, randomUUID } = await import('node:crypto');
  const pool = new Pool({ connectionString: process.env.DIRECT_URL, max: 1 });
  try {
    const authId = randomUUID();
    const name = `Staff ${email.split('@')[0]}`;
    await pool.query(
      `insert into auth_user (id, name, email, email_verified) values ($1, $2, $3, true)`,
      [authId, name, email],
    );
    const u = await pool.query(
      `insert into users (id, company_id, email, name, status, manager_id, auth_user_id)
       select gen_random_uuid(), c.id, $1, $2, 'active', $3, $4 from companies c where c.slug = 'demo'
       returning id, company_id`,
      [email, name, managerId, authId],
    );
    const { id, company_id: c } = u.rows[0];
    await pool.query(
      `insert into user_roles (company_id, user_id, role_id)
       select $1, $2, r.id from roles r where r.company_id = $1 and r.key = $3`,
      [c, id, role],
    );
    for (const t of territoryIds)
      await pool.query(
        `insert into user_territories (company_id, user_id, territory_id) values ($1, $2, $3)`,
        [c, id, t],
      );
    const token = randomBytes(24).toString('hex');
    await pool.query(
      `insert into auth_session (id, token, user_id, expires_at) values ($1, $2, $3, now() + interval '1 day')`,
      [randomUUID(), token, authId],
    );
    return { id, bearer: `Bearer ${token}` };
  } finally {
    await pool.end();
  }
}

/**
 * A second headquarter under the seed's `otherArea` (outside every ABM subtree), written once per DB
 * as the owner (territories are created by import only): business managers hold HQs only.
 */
export async function otherHq(_http: Http, _admin: string, otherArea: string): Promise<string> {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DIRECT_URL, max: 1 });
  try {
    const code = 'HQ-OTHER-TEST';
    const found = await pool.query(`select id from territories where code = $1`, [code]);
    if (found.rowCount) return found.rows[0].id;
    const r = await pool.query(
      `insert into territories (id, company_id, parent_id, level, code, name, path)
       select x.id::uuid, p.company_id, p.id, 'headquarter', $2, 'Other HQ (test)', p.path || '.' || x.id
       from territories p, (select gen_random_uuid()::text as id) x where p.id = $1
       on conflict do nothing returning id`,
      [otherArea, code],
    );
    if (r.rowCount) return r.rows[0].id;
    return (await pool.query(`select id from territories where code = $1`, [code])).rows[0].id;
  } finally {
    await pool.end();
  }
}
