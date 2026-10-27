import { Inject, Injectable } from '@nestjs/common';
import { jobs, type Db, type Tx } from '@ariforce/db';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DB } from '../db/db.module';

export interface EnqueueOptions {
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

/** Enqueue jobs (docs/NOTIFICATIONS.md). Tenant jobs go in the caller's RLS transaction. */
@Injectable()
export class JobsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Company job inside the business transaction (RLS: company_id must be the tenant). */
  async enqueue(
    tx: Tx,
    companyId: string,
    type: string,
    payload: Record<string, unknown>,
    o: EnqueueOptions = {},
  ) {
    await tx
      .insert(jobs)
      .values({
        id: uuidv7(),
        companyId,
        type,
        payload,
        runAt: o.runAt ?? new Date(),
        maxAttempts: o.maxAttempts ?? 5,
        dedupeKey: o.dedupeKey ?? null,
      })
      .onConflictDoNothing();
  }

  /** System job (company_id null), deduped on (type, dedupeKey). */
  async enqueueSystem(type: string, payload: Record<string, unknown>, dedupeKey: string) {
    await this.db.execute(
      sql`select jobs_enqueue_system(${type}, ${JSON.stringify(payload)}::jsonb, now(), ${dedupeKey})`,
    );
  }
}
