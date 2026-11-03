import * as z from 'zod';
import { DateOnly, Id, Month, Timestamp } from './common';
import { KpiKey } from './kpis';

/**
 * Home screen API (SWE gaps 2026-10-29). Every endpoint is the caller's own data and needs no extra
 * permission; team parts are filled only when the caller has a team and the permission named below,
 * otherwise null.
 */

const Counts = z.object({ open: z.int().min(0), high: z.int().min(0) });

/** Approval subjects a decider can have waiting (current step is theirs or a shared queue they are in). */
export const ATTENTION_APPROVAL_TYPES = [
  'tour_plan',
  'tour_plan_item',
  'dcr_unlock',
  'leave',
  'expense',
  'doctor',
] as const;

export const MeAttention = z
  .object({
    serverTime: Timestamp,
    notifications: z.object({ unread: z.int().min(0) }),
    approvals: z
      .object({
        total: z.int().min(0),
        byType: z.record(z.enum(ATTENTION_APPROVAL_TYPES), z.int().min(0)),
      })
      .meta({
        description:
          'Waiting for you: pending requests whose current step names you, or a shared queue listing you (dcr_unlock to directors). Never your own requests. All six keys always present',
      }),
    dcrReview: z
      .object({ pending: z.int().min(0) })
      .nullable()
      .meta({
        description: 'Team DCRs submitted and not yet reviewed (needs dcr:review); null without it',
      }),
    exceptions: z.object({
      mine: Counts.meta({ description: 'Your own open exceptions (high = severity high)' }),
      team: Counts.nullable().meta({
        description: 'Open exceptions of your team, excluding yours (needs field:read); else null',
      }),
    }),
    myRequests: z
      .object({
        pending: z.int().min(0),
        unlockPending: z.int().min(0),
        rejectedLast7Days: z.int().min(0),
      })
      .meta({ description: 'Requests you raised that are still pending / were rejected recently' }),
    myDcr: z.object({
      draftsOpen: z.int().min(0).meta({ description: 'Your draft DCRs not yet submitted' }),
      rejectedOpen: z.int().min(0).meta({ description: 'Your rejected DCRs to fix and resubmit' }),
    }),
  })
  .meta({ id: 'MeAttention' });
export type MeAttention = z.infer<typeof MeAttention>;

export const PunchStatus = z.enum(['not_in', 'in', 'out']).meta({ id: 'PunchStatus' });

export const MeToday = z
  .object({
    date: DateOnly.meta({ description: "Today in the company's timezone" }),
    timezone: z.string(),
    serverTime: Timestamp,
    punch: z.object({
      status: PunchStatus,
      inAt: Timestamp.nullable(),
      outAt: Timestamp.nullable(),
    }),
    tourPlan: z.object({
      itemId: Id.nullable().meta({ description: 'Approved tour plan item covering today, if any' }),
      workTypeId: Id.nullable(),
      workTypeName: z.string().nullable(),
      territoryIds: z.array(Id),
      monthPlanId: Id.nullable(),
      monthPlanStatus: z.string().nullable(),
      plannedVisits: z
        .int()
        .min(0)
        .meta({ description: 'Doctor visits planned today (monthly plan)' }),
    }),
    dcr: z
      .object({
        id: Id,
        status: z.enum(['draft', 'submitted', 'approved', 'rejected']),
        calls: z.int().min(0),
        lockAt: Timestamp,
        locked: z.boolean(),
        neverLocks: z.boolean(),
      })
      .nullable()
      .meta({ description: "Today's DCR (latest non-deleted), null when none yet" }),
  })
  .meta({ id: 'MeToday' });
export type MeToday = z.infer<typeof MeToday>;

export const PlannedDoctorsQuery = z.object({
  date: DateOnly.optional().meta({ description: 'Default: today (company timezone)' }),
});

export const PlannedDoctor = z
  .object({
    doctorId: Id,
    name: z.string(),
    specialtyId: Id.nullable(),
    categoryId: Id.nullable(),
    territoryId: Id,
    source: z.enum(['tour_plan', 'tp_item_territory']).meta({
      description:
        "tour_plan: a planned visit for the date in the month's plan; tp_item_territory: a doctor in a territory of the approved tour plan item for the date",
    }),
    visited: z.boolean().meta({ description: 'Called on that date in your DCR' }),
    lastCallDate: DateOnly.nullable(),
  })
  .meta({ id: 'PlannedDoctor' });

export const PlannedDoctors = z
  .object({
    date: DateOnly,
    tourPlanId: Id.nullable(),
    tpItemId: Id.nullable(),
    items: z.array(PlannedDoctor).meta({ description: 'tour_plan first, then by name; max 500' }),
  })
  .meta({ id: 'PlannedDoctors' });
export type PlannedDoctors = z.infer<typeof PlannedDoctors>;

/** KPIs on the home card: month to date, computed by the KPI engine (GET /v1/kpis definitions). */
export const HOME_KPIS = [
  'call_average',
  'doctor_visits_per_day',
  'unique_doctors_seen',
  'coverage_pct',
  'frequency_compliance_pct',
  'dcr_compliance_pct',
  'dcr_on_time_pct',
  'tp_adherence_pct',
  'pob_value',
] as const satisfies readonly z.infer<typeof KpiKey>[];

export const MeKpiQuery = z
  .object({
    scope: z.enum(['self', 'team']).default('self').meta({
      description: 'self: you; team: your whole reporting line incl. you (403 without a team)',
    }),
    month: Month.optional().meta({ description: 'Default: this month, from the 1st to today' }),
  })
  .meta({ id: 'MeKpiQuery' });
