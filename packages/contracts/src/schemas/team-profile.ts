import * as z from 'zod';
import { DateOnly, Id, ListQuery, Timestamp, page } from './common';
import { KpiValue } from './kpis';
import { RoleKey } from './roles';
import { TeamNode, TeamTerritory } from './team';

/**
 * Team member profile (#75): one person in the viewer's reporting subtree. Read-only. No payroll/HR
 * data; contact fields are exactly what GET /v1/team already shows the same viewer.
 * Who: ABM and above (rank >= 2) with `reports:read`, for themselves or anyone strictly below them in
 * their subtree; Director for every hierarchy user. Out of scope = 404.
 */

export const AttendanceStatus = z
  .enum(['present', 'absent', 'leave', 'holiday', 'incomplete', 'weekly_off'])
  .meta({ id: 'ProfileAttendanceStatus' });

export const TeamProfile = z
  .object({
    member: TeamNode.omit({ depth: true }),
    manager: z
      .object({ id: Id, name: z.string(), role: RoleKey.nullable() })
      .nullable()
      .meta({ description: 'Direct manager (users.manager_id)' }),
    hq: TeamTerritory.nullable().meta({
      description: 'Headquarters: the most specific (deepest) assigned territory',
    }),
    counts: z.object({
      doctors: z.int().meta({
        description: 'Approved doctors in the person’s territories (incl. sub-territories)',
      }),
      chemists: z.int(),
      directReports: z.int(),
      subtreeSize: z.int().meta({ description: 'Everyone below the person (excl. themself)' }),
    }),
    today: z.object({
      date: DateOnly.meta({ description: 'Company-local (IST) date' }),
      status: AttendanceStatus,
      punchInAt: Timestamp.nullable(),
      punchOutAt: Timestamp.nullable(),
      leave: z
        .object({ requestId: Id, typeCode: z.string(), half: z.enum(['am', 'pm']).nullable() })
        .nullable(),
    }),
    lastPunchInAt: Timestamp.nullable().meta({ description: 'Latest punch-in on any day' }),
    canSeeExpenses: z.boolean().meta({
      description:
        'Viewer has expenses:approve or finance:read; performance.expenses is null otherwise',
    }),
  })
  .meta({ id: 'TeamProfile' });
export type TeamProfile = z.infer<typeof TeamProfile>;

export const PerformanceGranularity = z
  .enum(['week', 'month'])
  .meta({ id: 'PerformanceGranularity' });

const PerformanceRange = z.object({
  granularity: PerformanceGranularity.default('month'),
  from: DateOnly.optional().meta({
    description:
      'Default: start of the 6th month back (month) / 8th ISO week back (week). Snapped to bucket start',
  }),
  to: DateOnly.optional().meta({ description: 'Default today (IST). Snapped to bucket end' }),
});
const ordered = (q: { from?: string; to?: string }) => !q.from || !q.to || q.from <= q.to;
export const TeamPerformanceQuery = PerformanceRange.refine(ordered, {
  message: 'from must be <= to',
  path: ['to'],
}).meta({ id: 'TeamPerformanceQuery' });
export type TeamPerformanceQuery = z.infer<typeof TeamPerformanceQuery>;
/** Max buckets per request (422 RANGE_TOO_LONG above). */
export const PERFORMANCE_MAX_BUCKETS = { week: 26, month: 24 } as const;

export const PerformanceBucket = z
  .object({
    label: z.string().meta({ example: '2026-10 / 2026-W43' }),
    from: DateOnly,
    to: DateOnly,
    workingDays: z.int(),
    metrics: z.array(KpiValue).meta({
      description:
        'Same keys/maths as GET /v1/kpis (self). Week buckets carry day-grain KPIs only (call averages, DCR compliance/on-time, POB); month buckets carry all KPIs incl. coverage, TP adherence and sales vs target',
    }),
    attendance: z.object({
      presentDays: z.int().meta({ description: 'Days with a punch-in' }),
      leaveDays: z.number().meta({ description: 'Approved leave + leave DCRs, half = 0.5' }),
      holidayDays: z.int(),
      absentDays: z.number().meta({ description: 'Working days up to today − present − leave' }),
    }),
    expenses: z
      .object({
        claimed: z.number().meta({
          description: 'INR, lines dated in the bucket on submitted/approved/paid claims',
        }),
        approved: z.number().meta({ description: 'INR, of which on approved/paid claims' }),
      })
      .nullable(),
  })
  .meta({ id: 'PerformanceBucket' });

export const TeamPerformance = z
  .object({
    userId: Id,
    granularity: PerformanceGranularity,
    from: DateOnly,
    to: DateOnly,
    generatedAt: Timestamp,
    buckets: z.array(PerformanceBucket),
    total: PerformanceBucket.meta({ description: 'Whole range; label "total"' }),
  })
  .meta({ id: 'TeamPerformance' });
export type TeamPerformance = z.infer<typeof TeamPerformance>;

export const TeamOutletQuery = ListQuery.pick({
  limit: true,
  cursor: true,
  q: true,
  includeTotal: true,
})
  .extend({
    territoryId: Id.optional().meta({
      description: 'Narrow to one of the person’s territories (incl. children)',
    }),
  })
  .meta({ id: 'TeamOutletQuery' });

export const TeamMemberDoctor = z
  .object({
    id: Id,
    name: z.string(),
    qualification: z.string().nullable(),
    specialty: z.string().nullable(),
    category: z.string().nullable(),
    territoryId: Id,
    territoryName: z.string(),
    city: z.string().nullable(),
    requiredVisits: z.int().meta({ description: 'Visits per cycle (category or override)' }),
    visitsThisMonth: z.int().meta({ description: 'Doctor calls by this person this month' }),
    lastVisitDate: DateOnly.nullable().meta({ description: 'Last call by this person' }),
  })
  .meta({
    id: 'TeamMemberDoctor',
    description: 'No phone/address/DOB (PII kept to the masters API)',
  });
export const TeamMemberDoctorPage = page(TeamMemberDoctor, 'TeamMemberDoctorPage');

export const TeamMemberChemist = z
  .object({
    id: Id,
    name: z.string(),
    territoryId: Id,
    territoryName: z.string(),
    city: z.string().nullable(),
    lastVisitDate: DateOnly.nullable(),
  })
  .meta({ id: 'TeamMemberChemist' });
export const TeamMemberChemistPage = page(TeamMemberChemist, 'TeamMemberChemistPage');

export const TeamProfileExportQuery = PerformanceRange.extend({ format: z.enum(['xlsx', 'pdf']) })
  .refine(ordered, { message: 'from must be <= to', path: ['to'] })
  .meta({ id: 'TeamProfileExportQuery' });
export type TeamProfileExportQuery = z.infer<typeof TeamProfileExportQuery>;
