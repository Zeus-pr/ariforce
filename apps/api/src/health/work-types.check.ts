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

  /** Never blocks or fails boot. */
  onApplicationBootstrap() {
    void this.warnings(true).then((ws) => {
      for (const w of ws)
        if (w.code === 'NO_WORK_TYPES')
          this.log.warn(
            `Company '${w.companySlug}' (${w.companyId}) has no work types; DCR/Tour Plan dropdowns will be empty. Apply migration 0026_work_types_defaults.`,
          );
        else this.log.warn(`Work types check failed: ${w.message}`);
    });
  }

  async warnings(fresh = false): Promise<HealthWarning[]> {
    if (!fresh && this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.value;
    let value: HealthWarning[];
    try {
      const r = await this.pool.query<{ company_id: string; slug: string }>(
        'select company_id, slug from companies_without_work_types()',
      );
      value = r.rows.map((x) => ({
        code: 'NO_WORK_TYPES' as const,
        companyId: x.company_id,
        companySlug: x.slug,
        message: 'Company has no active work types',
      }));
    } catch (e) {
      value = [
        {
          code: 'WORK_TYPES_CHECK_FAILED' as const,
          companyId: null,
          companySlug: null,
          message: (e as Error).message.slice(0, 200),
        },
      ];
    }
    this.cache = { at: Date.now(), value };
    return value;
  }
}
