/**
 * Local/CI only: create better-auth identities for the demo staff and link them to tenant users.
 * Runs as the owner (DIRECT_URL). Refuses to run in production. Password from DEMO_PASSWORD.
 */
import { hashPassword } from 'better-auth/crypto';
import { Client } from 'pg';
import { DEMO_COMPANY_ID, U } from '@ariforce/db';

if (process.env.NODE_ENV === 'production') throw new Error('seed-auth is dev/CI only');
const url = process.env.DIRECT_URL;
if (!url) throw new Error('DIRECT_URL is required');
const password = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';

const c = new Client({ connectionString: url });
await c.connect();
const hash = await hashPassword(password);
for (const [key, userId] of Object.entries(U)) {
  const { rows } = await c.query<{ email: string; name: string }>(
    'select email, name from users where id = $1 and company_id = $2',
    [userId, DEMO_COMPANY_ID],
  );
  const u = rows[0];
  if (!u) continue;
  const authId = `seed-${key}`;
  await c.query(
    `insert into auth_user (id, name, email, email_verified) values ($1, $2, lower($3), true)
     on conflict (id) do nothing`,
    [authId, u.name, u.email],
  );
  await c.query(
    `insert into auth_account (id, account_id, provider_id, user_id, password)
     values ($1, $2, 'credential', $2, $3) on conflict (id) do update set password = excluded.password`,
    [`seed-acc-${key}`, authId, hash],
  );
  await c.query('update users set auth_user_id = $1 where id = $2', [authId, userId]);
}
await c.end();
console.log('auth seed done');
