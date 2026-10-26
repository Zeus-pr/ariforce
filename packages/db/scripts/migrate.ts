import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL (owner role) is required');
const pool = new Pool({ connectionString: url });
await migrate(drizzle(pool), { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
// Local/CI only: give the non-superuser app role a login so tests run with RLS enforced.
if (process.env.NODE_ENV !== 'production' && process.env.APP_DB_PASSWORD !== '') {
  const pw = (process.env.APP_DB_PASSWORD ?? 'ariforce_app').replace(/'/g, "''");
  await pool.query(`ALTER ROLE ariforce_app LOGIN PASSWORD '${pw}'`);
}
await pool.end();
console.log('migrations applied');
