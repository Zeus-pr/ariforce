import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { withTenant, type Db, type Tx } from '@ariforce/db';
import { sql } from 'drizzle-orm';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DB } from '../db/db.module';
import { JobsService } from './jobs.service';

export interface JobContext {
  tx: Tx;
  companyId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}
export type JobHandler = (ctx: JobContext) => Promise<void>;

type Claimed = {
  job_id: string;
  job_company_id: string | null;
  job_type: string;
  job_payload: Record<string, unknown>;
  job_attempts: number;
  job_max_attempts: number;
};

const num = (name: string, def: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
};

/** Exponential backoff: 30s, 60s, 120s ... capped at 1h. */
export const backoffSeconds = (attempts: number) =>
  Math.min(30 * 2 ** Math.max(attempts - 1, 0), 3600);

/** Default on in production, off elsewhere; JOBS_RUNNER_ENABLED=true|false overrides. */
export const runnerEnabled = () =>
  process.env.JOBS_RUNNER_ENABLED
    ? process.env.JOBS_RUNNER_ENABLED === 'true'
    : process.env.NODE_ENV === 'production';

/**
 * DB-backed job runner (#35). Polls jobs_claim() (FOR UPDATE SKIP LOCKED, one statement), runs each
 * handler in its own transaction (withTenant for company jobs), then jobs_finish / jobs_fail.
 */
@Injectable()
export class JobsRunner implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly log = new Logger('JobsRunner');
  private readonly handlers = new Map<string, JobHandler>();
  readonly worker = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<unknown> | null = null;
  private stopping = false;
  private lastCleanupDay = '';

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jobs: JobsService,
  ) {
    this.register('maintenance.cleanup', async ({ tx, payload }) => {
      const readDays = Number(payload.readDays ?? 90);
      const doneDays = Number(payload.doneDays ?? 14);
      const r = await tx.execute<{ deleted_notifications: number; deleted_jobs: number }>(
        sql`select * from jobs_cleanup(${readDays}, ${doneDays})`,
      );
      this.log.log(
        `cleanup: ${r.rows[0]?.deleted_notifications ?? 0} notifications, ${r.rows[0]?.deleted_jobs ?? 0} jobs`,
      );
    });
  }

  register(type: string, handler: JobHandler) {
    this.handlers.set(type, handler);
  }

  onApplicationBootstrap() {
    if (!runnerEnabled()) return;
    const every = num('JOBS_POLL_MS', 2000);
    this.log.log(`runner on (${this.worker}, every ${every} ms)`);
    this.timer = setInterval(() => {
      if (this.inFlight || this.stopping) return;
      this.inFlight = this.tick()
        .catch((e: Error) => this.log.error(`tick failed: ${e.message}`))
        .finally(() => (this.inFlight = null));
    }, every);
  }

  async beforeApplicationShutdown() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }

  private async tick() {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.lastCleanupDay) {
      await this.jobs.enqueueSystem('maintenance.cleanup', {}, day);
      this.lastCleanupDay = day;
    }
    await this.runOnce();
  }

  /** Claim and run one batch. Returns how many jobs were processed. Tests call this directly. */
  async runOnce(limit = num('JOBS_BATCH_SIZE', 10), worker = this.worker): Promise<number> {
    const lockTimeout = num('JOBS_LOCK_TIMEOUT_S', 300);
    const r = await this.db.execute<Claimed>(
      sql`select * from jobs_claim(${worker}, ${limit}, ${lockTimeout})`,
    );
    for (const j of r.rows) await this.runJob(j, worker);
    return r.rows.length;
  }

  private async runJob(j: Claimed, worker: string) {
    const handler = this.handlers.get(j.job_type);
    try {
      if (!handler) throw new Error(`No handler for job type ${j.job_type}`);
      const ctx = (tx: Tx) =>
        handler({
          tx,
          companyId: j.job_company_id,
          payload: j.job_payload ?? {},
          attempts: j.job_attempts,
        });
      if (j.job_company_id) await withTenant(this.db, { companyId: j.job_company_id }, ctx);
      else await this.db.transaction(ctx);
      await this.db.execute(sql`select jobs_finish(${j.job_id}::uuid, ${worker})`);
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : 'Unknown error';
      const res = await this.db.execute<{ jobs_fail: string | null }>(
        sql`select jobs_fail(${j.job_id}::uuid, ${worker}, ${msg}, ${backoffSeconds(j.job_attempts)})`,
      );
      const status = res.rows[0]?.jobs_fail;
      if (status === 'dead')
        this.log.error(`job ${j.job_id} (${j.job_type}) is dead after ${j.job_attempts} attempts`);
      else this.log.warn(`job ${j.job_id} (${j.job_type}) failed, retry: ${msg.slice(0, 200)}`);
    }
  }
}
