import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, createPool, type Db } from '@ariforce/db';
import type { Pool } from 'pg';

export const DB = Symbol('DB');
export const POOL = Symbol('POOL');

/**
 * One pg pool on DATABASE_URL (Supabase transaction pooler in prod, non-bypass role `ariforce_app`).
 * Unnamed queries only (no prepared statements); tenant context is set per transaction in withTenant().
 */
@Global()
@Module({
  providers: [
    {
      provide: POOL,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url && process.env.NODE_ENV === 'production')
          throw new Error('DATABASE_URL is required');
        // Pool connects lazily; dev/test without a DB still serves /health and /openapi.json.
        if (!url) return createPool('postgres://ariforce_app@localhost:5432/ariforce');
        return createPool(url, { max: Number(process.env.DB_POOL_MAX ?? 10) });
      },
    },
    { provide: DB, inject: [POOL], useFactory: (pool: Pool): Db => createDb(pool) },
  ],
  exports: [DB, POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}
