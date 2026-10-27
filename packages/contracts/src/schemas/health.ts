import * as z from 'zod';

/**
 * Non-fatal operational warnings on the public GET /v1/health (status stays 'ok').
 * Aggregate only: no company ids or slugs (those go to the API boot log).
 */
export const HealthWarning = z
  .discriminatedUnion('code', [
    z.object({
      code: z.literal('NO_WORK_TYPES').meta({
        description: 'Some companies have no active work types (DCR/Tour Plan dropdowns empty)',
      }),
      count: z.int().min(1).meta({ description: 'Number of such companies' }),
      message: z.string(),
    }),
    z.object({
      code: z.literal('WORK_TYPES_CHECK_FAILED').meta({
        description: 'The check could not run (DB unreachable or migration 0026 missing)',
      }),
      message: z.string(),
    }),
  ])
  .meta({ id: 'HealthWarning' });
export type HealthWarning = z.infer<typeof HealthWarning>;

export const Health = z
  .object({
    status: z.literal('ok'),
    warnings: z.array(HealthWarning).meta({ description: 'Empty when all is well; cached ~60 s' }),
  })
  .meta({ id: 'Health' });
export type Health = z.infer<typeof Health>;
