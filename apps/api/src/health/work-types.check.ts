import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { HealthWarning } from '@ariforce/contracts';
import type { Pool } from 'pg';
import { POOL } from '../db/db.module';

const TTL_MS = 60_000;

/**
 * Companies with no active work types (DCR / Tour Plan dropdowns would be empty). Reads across
 * companies through the SECURITY DEFINER helper companies_without_work_types() (migration 0026),
 * since the app role is RLS-bound and there is no tenant context at boot or on /health.
 */
@Injectable()
export class WorkTypesCheck implements OnApplicationBootstrap {
  private readonly log = new Logger('WorkTypesCheck');
  private cache: { at: number; value: HealthWarning[] } | null = null;

  constructor(@Inject(POOL) private readonly pool: Pool) {}

  /** Never blocks or fails boot. Per-company detail is logged here only, never on /health. */
  onApplicationBootstrap() {
    void this.companies().then(
      (cs) => {
        for (const c of cs)
          this.log.warn(
            `Company '${c.slug}' (${c.company_id}) has no work types; DCR/Tour Plan dropdowns will be empty. Apply migration 0026_work_types_defaults.`,
          );
      },
      (e: Error) => this.log.warn(`Work types check failed: ${e.message.slice(0, 200)}`),
    );
  }

  private async companies() {
    const r = await this.pool.query<{ company_id: string; slug: string }>(
      'select company_id, slug from companies_without_work_types()',
    );
    return r.rows;
  }

  /** Aggregate warnings for the public health endpoint. */
  async warnings(fresh = false): Promise<HealthWarning[]> {
    if (!fresh && this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.value;
    let value: HealthWarning[];
    try {
      const n = (await this.companies()).length;
      value = n
        ? [
            {
              code: 'NO_WORK_TYPES',
              count: n,
              message: `${n} compan${n === 1 ? 'y has' : 'ies have'} no active work types`,
            },
          ]
        : [];
    } catch {
      value = [{ code: 'WORK_TYPES_CHECK_FAILED', message: 'Work types check could not run' }];
    }
    this.cache = { at: Date.now(), value };
    return value;
  }
}
