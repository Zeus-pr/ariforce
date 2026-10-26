import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createPool(connectionString: string, opts: PoolConfig = {}) {
  return new Pool({ connectionString, max: 10, ...opts });
}

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}

export interface TenantContext {
  companyId: string;
  userId?: string | null;
  requestId?: string | null;
}

/**
 * Run `fn` in a transaction with the tenant context set via SET LOCAL (transaction-scoped,
 * safe with PgBouncer transaction pooling). RLS policies read `app.current_company_id`;
 * audit triggers/helpers read `app.current_user_id` and `app.request_id`.
 */
export async function withTenant<T>(
  db: Db,
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_company_id', ${ctx.companyId}, true),
                 set_config('app.current_user_id', ${ctx.userId ?? ''}, true),
                 set_config('app.request_id', ${ctx.requestId ?? ''}, true)`,
    );
    return fn(tx);
  });
}
