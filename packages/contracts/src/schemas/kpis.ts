import * as z from 'zod';
import { DateOnly, Id, Month, Timestamp } from './common';

/** KPI keys; definitions in docs/kpi-definitions.md, SQL in packages/db/drizzle/0009_kpi_views.sql. */
export const KPI_KEYS = [
  'call_average',
  'chemist_call_average',
  'coverage_pct',
  'frequency_compliance_pct',
  'missed_doctor_pct',
  'unique_doctors_seen',
  'doctor_visits_per_day',
  'dcr_compliance_pct',
  'dcr_on_time_pct',
  'tp_adherence_pct',
  'msl_size',
  'pob_value',
  'pob_achievement_pct',
  'primary_sales_value',
  'primary_achievement_pct',
  'secondary_sales_value',
  'secondary_achievement_pct',
  'growth_vs_ly_pct',
] as const;
export const KpiKey = z.enum(KPI_KEYS).meta({ id: 'KpiKey' });
export type KpiKey = z.infer<typeof KpiKey>;

export const KpiRollup = z.enum(['self', 'team', 'byUser', 'byTerritory', 'company']).meta({
  id: 'KpiRollup',
  description: 'company is Director-only; team/byUser need a reporting line',
});

const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(item));

export const KpiQuery = z
  .object({
    month: Month.optional(),
    from: DateOnly.optional(),
    to: DateOnly.optional(),
    rollup: KpiRollup.default('self'),
    userId: Id.optional(),
    territoryId: Id.optional().meta({ description: 'Includes descendant territories' }),
    divisionId: Id.optional(),
    productId: Id.optional(),
    kpis: csv(KpiKey).optional().meta({ description: 'Comma-separated KPI keys; default all' }),
  })
  .refine((q) => !(q.month && (q.from || q.to)), { message: 'Use month or from/to, not both' })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from must be <= to' })
  .meta({ id: 'KpiQuery' });

export const KpiUnit = z.enum(['count', 'ratio', 'percent', 'inr']).meta({ id: 'KpiUnit' });

export const KpiValue = z
  .object({
    kpi: KpiKey,
    value: z.number().nullable().meta({ description: 'null when the denominator is 0/absent' }),
    numerator: z.number().nullable(),
    denominator: z.number().nullable(),
    unit: KpiUnit,
    target: z.number().nullable(),
  })
  .meta({ id: 'KpiValue' });

export const KpiRow = z
  .object({
    userId: Id.nullable(),
    territoryId: Id.nullable(),
    label: z.string(),
    metrics: z.array(KpiValue),
  })
  .meta({ id: 'KpiRow' });

export const KpiReport = z
  .object({
    from: DateOnly,
    to: DateOnly,
    rollup: KpiRollup,
    generatedAt: Timestamp,
    rows: z.array(KpiRow),
  })
  .meta({ id: 'KpiReport' });

export const ProductKpiRow = z
  .object({
    productId: Id,
    productName: z.string(),
    detailedCalls: z.number().int(),
    firstPositionCalls: z.number().int(),
    detailingSharePct: z.number().nullable(),
    sampleQty: z.number().int(),
    pobQty: z.number().int(),
    pobValue: z.number(),
  })
  .meta({ id: 'ProductKpiRow' });

export const ProductKpiReport = z
  .object({ from: DateOnly, to: DateOnly, rows: z.array(ProductKpiRow) })
  .meta({ id: 'ProductKpiReport' });

export type KpiReport = z.infer<typeof KpiReport>;
export type ProductKpiReport = z.infer<typeof ProductKpiReport>;
