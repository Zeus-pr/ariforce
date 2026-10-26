/** Applies packages/db/migrations/*.sql in order over DIRECT_URL (owner). Each file is idempotent. */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const url = process.env.DIRECT_URL;
if (!url) throw new Error('DIRECT_URL (direct owner connection, migrations only) is required');
const dir = resolve(import.meta.dirname, '../migrations');
const client = new Client({ connectionString: url });
await client.connect();
for (const f of readdirSync(dir)
  .filter((x) => x.endsWith('.sql'))
  .sort()) {
  await client.query(readFileSync(resolve(dir, f), 'utf8'));
  console.log(`applied ${f}`);
}
// Local/CI only: give the app role a login. In Supabase set the password manually (docs/SETUP.md).
const pw =
  process.env.APP_DB_PASSWORD ??
  (process.env.CI || process.env.NODE_ENV === 'development' ? 'ariforce_app' : '');
if (pw) await client.query(`ALTER ROLE ariforce_app LOGIN PASSWORD '${pw.replace(/'/g, "''")}'`);
await client.end();
console.log('migrations applied');
