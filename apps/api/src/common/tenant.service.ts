import { Inject, Injectable } from '@nestjs/common';
import { withTenant, type Db, type Tx } from '@ariforce/db';
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { DB } from '../db/db.module';
import type { Principal } from '../auth/principal';

/**
 * Every tenant query runs here: one transaction, `set_config('app.current_company_id', ..., true)`
 * (transaction-local, safe on the Supabase transaction pooler). RLS enforces the company;
 * `scope()` adds the hierarchy filter on top.
 */
@Injectable()
export class TenantService {
  constructor(@Inject(DB) private readonly db: Db) {}

  run<T>(p: Principal, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(
      this.db,
      { companyId: p.companyId, userId: p.userId, requestId: p.requestId },
      fn,
    );
  }

  /** Territory-subtree filter on a `territories.path` column. undefined = company-wide. */
  scope(p: Principal, pathCol: AnyPgColumn): SQL | undefined {
    if (p.scopePaths === null) return undefined;
    if (p.scopePaths.length === 0) return sql`false`;
    const parts = p.scopePaths.map(
      (path) => sql`(${pathCol} = ${path} or ${pathCol} like ${path + '.%'})`,
    );
    return sql`(${sql.join(parts, sql` or `)})`;
  }
}
