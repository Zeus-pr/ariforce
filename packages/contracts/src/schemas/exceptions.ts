import * as z from 'zod';
import { DateOnly, Id, Timestamp, page } from './common';

/**
 * Exception and Alert Center (#56, extends #29 "Needs Attention"). Rules are data: defaults below,
 * per-company overrides in exception_rules. See docs/EXCEPTIONS.md.
 */
export const EXCEPTION_SEVERITIES = ['low', 'medium', 'high'] as const;
export const ExceptionSeverity = z.enum(EXCEPTION_SEVERITIES).meta({ id: 'ExceptionSeverity' });
export type ExceptionSeverity = z.infer<typeof ExceptionSeverity>;
export const SEVERITY_RANK: Record<ExceptionSeverity, number> = { low: 1, medium: 2, high: 3 };

export const EXCEPTION_STATUSES = ['open', 'acknowledged', 'resolved', 'dismissed'] as const;
export const ExceptionStatus = z.enum(EXCEPTION_STATUSES).meta({ id: 'ExceptionStatus' });
export type ExceptionStatus = z.infer<typeof ExceptionStatus>;

export const EXCEPTION_RULE_CODES = [
  'dcr_missing',
  'punch_without_dcr',
  'dcr_late',
  'low_call_average',
  'no_punch_in',
  'geofence_breach',
  'tp_not_submitted',
  'coverage_gap',
] as const;
export const ExceptionRuleCode = z.enum(EXCEPTION_RULE_CODES).meta({ id: 'ExceptionRuleCode' });
export type ExceptionRuleCode = z.infer<typeof ExceptionRuleCode>;

export interface ExceptionRuleDefault {
  name: string;
  description: string;
  grain: 'day' | 'month';
  severity: ExceptionSeverity;
  /** null = rule has no threshold. */
  threshold: number | null;
  thresholdUnit: string | null;
  thresholdMin?: number;
  thresholdMax?: number;
  action: string;
}

/** Code defaults (no exception_rules row = these). */
export const EXCEPTION_RULES: Record<ExceptionRuleCode, ExceptionRuleDefault> = {
  dcr_missing: {
    name: 'DCR missing',
    description:
      'Working day, not on full-day leave, lock passed, no submitted DCR and no punch-in.',
    grain: 'day',
    severity: 'high',
    threshold: null,
    thresholdUnit: null,
    action: 'Call the rep; if the day was worked, have them request a DCR correction.',
  },
  punch_without_dcr: {
    name: 'Punched in without DCR',
    description: 'Punched in on a working day but no submitted DCR by the lock.',
    grain: 'day',
    severity: 'high',
    threshold: null,
    thresholdUnit: null,
    action: 'Ask the rep to request a DCR correction for the day and report the calls made.',
  },
  dcr_late: {
    name: 'DCR submitted late',
    description: 'DCR submitted after the on-time deadline (date + 1 day, IST).',
    grain: 'day',
    severity: 'low',
    threshold: null,
    thresholdUnit: null,
    action: 'Remind the rep to submit the DCR the same evening.',
  },
  low_call_average: {
    name: 'Low call average',
    description: 'Field-day DCR with fewer doctor calls than the threshold.',
    grain: 'day',
    severity: 'medium',
    threshold: 8,
    thresholdUnit: 'doctor calls per day',
    thresholdMin: 1,
    thresholdMax: 50,
    action: 'Review the tour plan and doctor list with the rep; plan a joint working day.',
  },
  no_punch_in: {
    name: 'No punch-in',
    description: 'Working day, not on leave, no leave/holiday DCR and no punch-in.',
    grain: 'day',
    severity: 'medium',
    threshold: null,
    thresholdUnit: null,
    action: 'Check attendance with the rep; apply leave if they were absent.',
  },
  geofence_breach: {
    name: 'Visits outside geofence',
    description: 'Visit check-ins outside the outlet fence or with a mock location.',
    grain: 'day',
    severity: 'medium',
    threshold: 1,
    thresholdUnit: 'visits per day',
    thresholdMin: 1,
    thresholdMax: 50,
    action: 'Verify the visits with the rep; re-tag outlet locations if they are wrong.',
  },
  tp_not_submitted: {
    name: 'Tour plan not submitted',
    description: "Next month's tour plan not submitted by the threshold day of the month.",
    grain: 'month',
    severity: 'high',
    threshold: 25,
    thresholdUnit: 'day of month',
    thresholdMin: 1,
    thresholdMax: 28,
    action: "Ask the rep to submit next month's tour plan today.",
  },
  coverage_gap: {
    name: 'Doctor coverage gap',
    description: 'Share of listed doctors whose visit frequency was not met in the month.',
    grain: 'month',
    severity: 'medium',
    threshold: 20,
    thresholdUnit: '% of listed doctors missed',
    thresholdMin: 0,
    thresholdMax: 100,
    action: 'Go through missed doctors with the rep and add them to next month’s tour plan.',
  },
};

export const ExceptionRule = z
  .object({
    code: ExceptionRuleCode,
    name: z.string(),
    description: z.string(),
    grain: z.enum(['day', 'month']),
    enabled: z.boolean(),
    severity: ExceptionSeverity,
    threshold: z.number().nullable(),
    thresholdUnit: z.string().nullable(),
    action: z.string().meta({ description: 'Suggested corrective action shown with exceptions' }),
    isDefault: z.boolean().meta({ description: 'true = no company override stored' }),
    version: z.int().nullable().meta({ description: 'Override row version; null when default' }),
  })
  .meta({ id: 'ExceptionRule' });
export type ExceptionRule = z.infer<typeof ExceptionRule>;
export const ExceptionRuleList = z
  .object({ items: z.array(ExceptionRule) })
  .meta({ id: 'ExceptionRuleList' });

export const ExceptionRuleUpdate = z
  .object({
    enabled: z.boolean().optional(),
    severity: ExceptionSeverity.optional(),
    threshold: z.number().min(0).max(1000).optional(),
    action: z.string().trim().min(1).max(500).optional(),
    reset: z
      .boolean()
      .optional()
      .meta({ description: 'true = delete the override (back to defaults); other fields ignored' }),
    version: z.int().optional().meta({ description: 'Optimistic lock on the override row' }),
  })
  .meta({ id: 'ExceptionRuleUpdate' });
export type ExceptionRuleUpdate = z.infer<typeof ExceptionRuleUpdate>;
export const ExceptionRuleParam = z.object({ code: ExceptionRuleCode });

const PersonRef = z.object({ id: Id, name: z.string() }).meta({ id: 'ExceptionPersonRef' });

export const ExceptionItem = z
  .object({
    id: Id,
    ruleCode: ExceptionRuleCode,
    ruleName: z.string(),
    severity: ExceptionSeverity,
    status: ExceptionStatus,
    periodDate: DateOnly.meta({
      description: 'Day rules: the date. Month rules: 1st of the month',
    }),
    user: PersonRef.meta({ description: 'Whose exception it is' }),
    assignee: PersonRef.nullable().meta({ description: 'Owner for follow-up' }),
    followUpOn: DateOnly.nullable(),
    value: z.number().nullable().meta({ description: 'Measured value (calls, visits, % ...)' }),
    threshold: z.number().nullable(),
    context: z.record(z.string(), z.unknown()),
    suggestedAction: z.string(),
    explanation: z.string().nullable(),
    explainedAt: Timestamp.nullable(),
    resolutionNote: z.string().nullable(),
    resolvedBy: PersonRef.nullable(),
    resolvedAt: Timestamp.nullable(),
    autoResolved: z.boolean(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    version: z.int(),
  })
  .meta({ id: 'Exception' });
export type ExceptionItem = z.infer<typeof ExceptionItem>;
export const ExceptionPage = page(ExceptionItem, 'ExceptionPage');

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .max(200)
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(values)))
    .meta({ description: `Comma-separated: ${values.join(', ')}` });

const ordered = (q: { from?: string; to?: string }) => !q.from || !q.to || q.from <= q.to;
export const ExceptionListQuery = z
  .object({
    status: csv(EXCEPTION_STATUSES).optional(),
    severity: csv(EXCEPTION_SEVERITIES).optional(),
    ruleCode: csv(EXCEPTION_RULE_CODES).optional(),
    userId: Id.optional(),
    assignedToMe: z.enum(['true', 'false']).optional(),
    from: DateOnly.optional().meta({ description: 'periodDate >= from' }),
    to: DateOnly.optional().meta({ description: 'periodDate <= to' }),
    limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
    cursor: z.string().max(200).optional().meta({ description: 'Opaque cursor from `nextCursor`' }),
  })
  .refine(ordered, { message: 'from must be <= to', path: ['to'] })
  .meta({ id: 'ExceptionListQuery' });
export type ExceptionListQuery = z.output<typeof ExceptionListQuery>;

export const ExceptionSummaryQuery = z
  .object({
    from: DateOnly.optional().meta({ description: 'Default: today - 30 days' }),
    to: DateOnly.optional().meta({ description: 'Default: today' }),
    userId: Id.optional(),
  })
  .refine(ordered, { message: 'from must be <= to', path: ['to'] })
  .meta({ id: 'ExceptionSummaryQuery' });

const SevCounts = z.object({ low: z.int(), medium: z.int(), high: z.int() });
export const ExceptionSummary = z
  .object({
    from: DateOnly,
    to: DateOnly,
    total: z.int(),
    open: z.int().meta({ description: 'open + acknowledged' }),
    bySeverity: SevCounts,
    openBySeverity: SevCounts,
    byRule: z.array(
      z.object({
        ruleCode: ExceptionRuleCode,
        severity: ExceptionSeverity.meta({ description: 'Current rule severity' }),
        total: z.int(),
        open: z.int(),
      }),
    ),
  })
  .meta({ id: 'ExceptionSummary' });
export type ExceptionSummary = z.infer<typeof ExceptionSummary>;

const Note = z.string().trim().min(1).max(1000);
export const ExceptionNote = z.object({ note: Note }).meta({ id: 'ExceptionNote' });
export const ExceptionUpdate = z
  .object({
    assigneeId: Id.nullable().optional(),
    followUpOn: DateOnly.nullable().optional(),
    version: z.int().optional(),
  })
  .refine((v) => v.assigneeId !== undefined || v.followUpOn !== undefined, {
    message: 'Nothing to update',
  })
  .meta({ id: 'ExceptionUpdate' });
export type ExceptionUpdate = z.infer<typeof ExceptionUpdate>;

export const ExceptionEvaluateRequest = z
  .object({ from: DateOnly, to: DateOnly })
  .refine(ordered, { message: 'from must be <= to', path: ['to'] })
  .meta({ id: 'ExceptionEvaluateRequest' });
export const ExceptionEvaluateResult = z
  .object({ queued: z.boolean(), from: DateOnly, to: DateOnly })
  .meta({ id: 'ExceptionEvaluateResult' });

/** Additive TeamProfile section (#75 + #56). */
export const ProfileExceptions = z
  .object({
    open: z.int().meta({ description: 'open + acknowledged, any period' }),
    openHigh: z.int(),
    last30Days: z.int().meta({ description: 'Exceptions with periodDate in the last 30 days' }),
    byRule: z.array(z.object({ ruleCode: ExceptionRuleCode, count: z.int() })),
  })
  .meta({ id: 'ProfileExceptions' });
export type ProfileExceptions = z.infer<typeof ProfileExceptions>;
