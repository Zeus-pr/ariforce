/**
 * Provision the first System Admin (and optionally one demo user per role) in a real tenant.
 *
 *   pnpm -F @ariforce/api admin:create-first --company arighna --email admin@arighna.example \
 *     --name "System Admin" [--demo-users --demo-domain demo.arighna.example] [--territory <code>]
 *
 * Connects with DATABASE_URL (the non-bypass app role; loaded from apps/api/.env when present) and
 * writes inside a tenant transaction, so RLS applies. Passwords come from ARIFORCE_ADMIN_PASSWORD /
 * ARIFORCE_DEMO_PASSWORD or a hidden prompt; they are never printed or logged. Idempotent: existing
 * users are left as they are unless --reset-password is given.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { hashPassword } from 'better-auth/crypto';
import { Client } from 'pg';
import {
  DEFAULT_ROLE_PERMISSIONS,
  HIERARCHY_ROLE_KEYS,
  ROLE_NAMES,
  ROLE_RANK,
  type RoleKey,
} from '@ariforce/contracts';

const envFile = resolve(import.meta.dirname, '../.env');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

const { values: a } = parseArgs({
  options: {
    company: { type: 'string' },
    'company-id': { type: 'string' },
    email: { type: 'string' },
    name: { type: 'string', default: 'System Admin' },
    'demo-users': { type: 'boolean', default: false },
    'demo-domain': { type: 'string', default: 'demo.ariforce.in' },
    territory: { type: 'string' },
    'reset-password': { type: 'boolean', default: false },
  },
});
const fail = (m: string): never => {
  console.error(`admin:create-first: ${m}`);
  process.exit(1);
};
if (!a.email) fail('--email is required');
if (!a.company && !a['company-id']) fail('--company <slug> or --company-id <uuid> is required');
const url = process.env.DATABASE_URL ?? fail('DATABASE_URL is not set');

function prompt(label: string): Promise<string> {
  if (!process.stdin.isTTY) fail(`${label}: set the env var (no TTY for a prompt)`);
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as {
      _writeToOutput: (s: string) => void;
      output: NodeJS.WriteStream;
    };
    process.stdout.write(`${label}: `);
    out._writeToOutput = () => {};
    rl.question('', (v) => {
      rl.close();
      process.stdout.write('\n');
      done(v);
    });
  });
}
async function password(env: string, label: string) {
  const v = process.env[env] || (await prompt(`${label} (input hidden)`));
  if (v.length < 12) fail(`${label} must be at least 12 characters`);
  return v;
}

const adminPw = await password('ARIFORCE_ADMIN_PASSWORD', 'System Admin password');
const demoPw = a['demo-users']
  ? await password('ARIFORCE_DEMO_PASSWORD', 'Demo users password')
  : '';

// Demo chain, top-down: director > vp > gm > sm > zbm > rbm > abm > bm.
const DEMO: { key: RoleKey; local: string; code: string }[] = [
  { key: 'director', local: 'director', code: 'DEMO-DIR' },
  { key: 'vice_president', local: 'vp', code: 'DEMO-VP' },
  { key: 'general_manager', local: 'gm', code: 'DEMO-GM' },
  { key: 'sales_manager', local: 'sm', code: 'DEMO-SM' },
  { key: 'zonal_business_manager', local: 'zbm', code: 'DEMO-ZBM' },
  { key: 'regional_business_manager', local: 'rbm', code: 'DEMO-RBM' },
  { key: 'area_business_manager', local: 'abm', code: 'DEMO-ABM' },
  { key: 'business_manager', local: 'bm', code: 'DEMO-BM' },
];

const c = new Client({ connectionString: url });
await c.connect();
const summary: string[] = [];
try {
  const companyId =
    a['company-id'] ??
    (await c.query<{ id: string | null }>('select company_id_by_slug($1) as id', [a.company]))
      .rows[0]?.id ??
    fail(`company '${a.company}' not found`);
  await c.query('begin');
  await c.query(
    `select set_config('app.current_company_id', $1, true), set_config('app.current_user_id', '', true),
            set_config('app.request_id', $2, true)`,
    [companyId, `admin-create-first-${randomUUID()}`],
  );

  // Roles: ensure all 9 exist with the default permissions (existing permissions are kept).
  const roleIds = new Map<RoleKey, string>();
  for (const key of [...HIERARCHY_ROLE_KEYS, 'system_admin'] as RoleKey[]) {
    const r = await c.query<{ id: string }>(
      `insert into roles (id, company_id, key, name, rank, permissions) values ($1, $2, $3, $4, $5, $6)
       on conflict (company_id, key) do update set name = excluded.name, rank = excluded.rank
       returning id`,
      [
        randomUUID(),
        companyId,
        key,
        ROLE_NAMES[key],
        ROLE_RANK[key],
        DEFAULT_ROLE_PERMISSIONS[key],
      ],
    );
    roleIds.set(key, r.rows[0]!.id);
  }

  let territoryId: string | null = null;
  if (a.territory) {
    const t = await c.query<{ id: string }>(
      'select id from territories where upper(code) = upper($1) and deleted_at is null',
      [a.territory],
    );
    territoryId = t.rows[0]?.id ?? fail(`territory '${a.territory}' not found`);
  }

  async function ensureUser(o: {
    email: string;
    name: string;
    code: string | null;
    role: RoleKey;
    managerId: string | null;
    pw: string;
    territory: boolean;
  }) {
    const email = o.email.toLowerCase();
    const found = await c.query<{ id: string; auth_user_id: string | null }>(
      'select id, auth_user_id from users where lower(email) = $1',
      [email],
    );
    let userId = found.rows[0]?.id;
    let authId = found.rows[0]?.auth_user_id ?? null;
    const isNew = !userId;
    if (!userId) {
      userId = randomUUID();
      await c.query(
        `insert into users (id, company_id, email, name, employee_code, manager_id, status)
         values ($1, $2, $3, $4,
           case when exists (select 1 from users where employee_code = $5) then null else $5 end,
           $6, 'active')`,
        [userId, companyId, email, o.name, o.code, o.managerId],
      );
    }
    await c.query(
      `insert into user_roles (company_id, user_id, role_id) values ($1, $2, $3) on conflict do nothing`,
      [companyId, userId, roleIds.get(o.role)],
    );
    if (o.territory && territoryId)
      await c.query(
        `insert into user_territories (company_id, user_id, territory_id, is_primary)
         select $1, $2, $3, true where not exists
           (select 1 from user_territories where user_id = $2 and territory_id = $3)`,
        [companyId, userId, territoryId],
      );
    if (!authId || a['reset-password'] || isNew) {
      const existing = await c.query<{ id: string }>('select id from auth_user where email = $1', [
        email,
      ]);
      authId = authId ?? existing.rows[0]?.id ?? randomUUID();
      await c.query(
        `insert into auth_user (id, name, email, email_verified) values ($1, $2, $3, true)
         on conflict (id) do nothing`,
        [authId, o.name, email],
      );
      const hash = await hashPassword(o.pw);
      const acc = await c.query<{ id: string }>(
        `select id from auth_account where user_id = $1 and provider_id = 'credential'`,
        [authId],
      );
      if (acc.rows[0])
        await c.query('update auth_account set password = $1, updated_at = now() where id = $2', [
          hash,
          acc.rows[0].id,
        ]);
      else
        await c.query(
          `insert into auth_account (id, account_id, provider_id, user_id, password)
           values ($1, $2, 'credential', $2, $3)`,
          [randomUUID(), authId, hash],
        );
      await c.query('update users set auth_user_id = $1 where id = $2', [authId, userId]);
    }
    await c.query(
      `insert into audit_log (company_id, actor_user_id, action, entity_type, entity_id, after)
       values ($1, null, $2, 'user', $3, $4)`,
      [
        companyId,
        isNew ? 'admin.user_created' : 'admin.user_ensured',
        userId,
        JSON.stringify({ email, role: o.role }),
      ],
    );
    summary.push(`${isNew ? 'created' : 'exists '} ${o.role.padEnd(26)} ${email}`);
    return userId;
  }

  await ensureUser({
    email: a.email!,
    name: a.name!,
    code: null,
    role: 'system_admin',
    managerId: null,
    pw: adminPw,
    territory: false,
  });
  if (a['demo-users']) {
    let manager: string | null = null;
    for (const d of DEMO)
      manager = await ensureUser({
        email: `${d.local}@${a['demo-domain']}`,
        name: `Demo ${ROLE_NAMES[d.key]}`,
        code: d.code,
        role: d.key,
        managerId: manager,
        pw: demoPw,
        territory: true,
      });
  }
  await c.query('commit');
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error(`admin:create-first failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
if (!process.exitCode) console.log(summary.join('\n'));
