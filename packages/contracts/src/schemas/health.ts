import * as z from 'zod';
import { Id } from './common';

/** Non-fatal operational warnings on GET /v1/health (status stays 'ok'). */
export const HealthWarning = z
  .object({
    code: z.enum(['NO_WORK_TYPES', 'WORK_TYPES_CHECK_FAILED']).meta({
      description:
        'NO_WORK_TYPES: a company has no active work types (DCR/Tour Plan dropdowns empty); WORK_TYPES_CHECK_FAILED: the check could not run (DB unreachable or migration 0026 missing)',
    }),
    companyId: Id.nullable(),
    companySlug: z.string().nullable(),
    message: z.string(),
  })
  .meta({ id: 'HealthWarning' });
export type HealthWarning = z.infer<typeof HealthWarning>;

export const Health = z
  .object({
    status: z.literal('ok'),
    warnings: z.array(HealthWarning).meta({ description: 'Empty when all is well; cached ~60 s' }),
  })
  .meta({ id: 'Health' });
export type Health = z.infer<typeof Health>;
