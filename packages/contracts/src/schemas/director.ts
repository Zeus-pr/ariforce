import * as z from 'zod';
import { DateOnly, Id, Timestamp, page } from './common';
import { RoleKey } from './roles';
import { CheckIn, DcrCall } from './field';
import { AttendanceStatus } from './team-profile';

/**
 * Director visibility (see docs/DIRECTOR-VISIBILITY.md): per-person activity (today and any range)
 * and the audit log reader. Scope rules are the existing ones: Director = whole company
 * (teamUserIds null); ABM and above = themselves plus their reporting subtree; System Admin has no
 * field data (403 on activity) but reads the audit log.
 */

/** Longest activity range: 93 days inclusive (a quarter). */
export const ACTIVITY_MAX_DAYS = 93;

export const TeamMemberActivityQuery = z
  .object({
    from: DateOnly.optional().meta({ description: 'Default: today (IST)' }),
    to: DateOnly.optional().meta({
      description: `Default: from. Inclusive; at most ${ACTIVITY_MAX_DAYS} days (else 422 RANGE_TOO_LONG); not after today (IST)`,
    }),
  })
  .meta({ id: 'TeamMemberActivityQuery' });
export type TeamMemberActivityQuery = z.infer<typeof TeamMemberActivityQuery>;

export const ActivityDcr = z
  .object({
    id: Id,
    status: z.enum(['draft', 'submitted', 'locked', 'approved', 'rejected']),
    workTypeId: Id,
    workTypeName: z.string(),
    callCount: z.int().min(0),
    startTime: z.string().nullable().meta({ description: 'details.startTime (HH:mm) when set' }),
    endTime: z.string().nullable(),
    durationMin: z.int().nullable(),
    expenseTotal: z.number().meta({ description: 'Live origin-dcr claim lines of this DCR' }),
  })
  .meta({ id: 'ActivityDcr' });

export const ActivityDay = z
  .object({
    date: DateOnly,
    attendance: AttendanceStatus,
    punchInAt: Timestamp.nullable(),
    punchOutAt: Timestamp.nullable(),
    leave: z
      .object({ requestId: Id, typeCode: z.string(), half: z.enum(['am', 'pm']).nullable() })
      .nullable(),
    planned: z.boolean().meta({ description: 'An approved tour-plan item covers the day' }),
    dcr: ActivityDcr.nullable().meta({
      description: 'The submitted/approved report of the day, else the newest draft; null if none',
    }),
    calls: z.int().min(0),
    checkIns: z.int().min(0).meta({ description: 'GPS captures (punch in/out and visits)' }),
  })
  .meta({ id: 'ActivityDay' });
export type ActivityDay = z.infer<typeof ActivityDay>;

export const ActivityTotals = z
  .object({
    days: z.int(),
    present: z.int(),
    absent: z.int(),
    leave: z.int(),
    holiday: z.int(),
    weeklyOff: z.int(),
    incomplete: z.int(),
    dcr: z.object({
      draft: z.int(),
      submitted: z.int(),
      approved: z.int(),
      rejected: z.int(),
      locked: z.int(),
      missing: z.int().meta({ description: 'Working days (not leave/holiday/off) without a DCR' }),
    }),
    calls: z.int(),
    checkIns: z.int(),
    plannedDays: z.int(),
    dcrExpenseTotal: z.number().meta({ description: 'Sum of ActivityDcr.expenseTotal' }),
    claimTotal: z.number().meta({
      description:
        'Totals of the person’s expense claims for the months touching the range (any status, not soft-deleted); 0 without expense visibility',
    }),
  })
  .meta({ id: 'ActivityTotals' });

export const ActivityCall = DcrCall.pick({
  id: true,
  outletKind: true,
  outletId: true,
  checkInId: true,
  calledAt: true,
  jointWorkUserIds: true,
})
  .extend({ dcrId: Id, outletName: z.string().nullable() })
  .meta({ id: 'ActivityCall' });

export const TeamMemberActivity = z
  .object({
    member: z.object({ id: Id, name: z.string(), role: RoleKey.nullable() }),
    from: DateOnly,
    to: DateOnly,
    today: DateOnly.meta({ description: 'Company-local (IST) today' }),
    days: z.array(ActivityDay).meta({ description: 'One row per date, oldest first' }),
    totals: ActivityTotals,
    detail: z
      .object({
        calls: z.array(ActivityCall).meta({ description: 'Calls of the day, by calledAt' }),
        checkIns: z.array(CheckIn).meta({ description: 'GPS captures of the day, by capturedAt' }),
      })
      .nullable()
      .meta({ description: 'Only for a single-day range (from = to), else null' }),
    canSeeExpenses: z.boolean().meta({ description: 'Same rule as TeamProfile.canSeeExpenses' }),
  })
  .meta({ id: 'TeamMemberActivity' });
export type TeamMemberActivity = z.infer<typeof TeamMemberActivity>;

// ---- audit log ----

export const AUDIT_REDACTED = '[redacted]';
/** Keys (case-insensitive, anywhere in before/after) whose values are replaced by AUDIT_REDACTED. */
export const AUDIT_REDACT_KEY =
  /token|secret|otp|password|passcode|hash|authorization|cookie|apikey|api_key|privatekey|private_key|signature/i;

export const AuditLogQuery = z
  .object({
    actorUserId: Id.optional().meta({ description: 'Who did it' }),
    action: z.string().min(1).max(100).optional().meta({
      description: "Exact action (e.g. 'dcr.submit'), or a prefix ending in '.' (e.g. 'dcr.')",
    }),
    entityType: z.string().min(1).max(60).optional(),
    entityId: z.string().min(1).max(100).optional().meta({ description: 'Needs entityType' }),
    from: DateOnly.optional().meta({ description: 'IST date, inclusive' }),
    to: DateOnly.optional().meta({ description: 'IST date, inclusive' }),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(200).optional().meta({ description: 'Opaque, from nextCursor' }),
  })
  .meta({ id: 'AuditLogQuery' });
export type AuditLogQuery = z.infer<typeof AuditLogQuery>;

export const AuditLogEntry = z
  .object({
    id: z.string().meta({ description: 'audit_log.id (bigint as string)' }),
    at: Timestamp,
    actor: z
      .object({ id: Id, name: z.string(), role: RoleKey.nullable() })
      .nullable()
      .meta({ description: 'null for system actions' }),
    action: z.string(),
    entityType: z.string().nullable(),
    entityId: z.string().nullable(),
    before: z.unknown().nullable().meta({ description: 'Row JSON with sensitive keys redacted' }),
    after: z.unknown().nullable().meta({ description: 'Row JSON with sensitive keys redacted' }),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    requestId: z.string().nullable(),
  })
  .meta({ id: 'AuditLogEntry' });
export type AuditLogEntry = z.infer<typeof AuditLogEntry>;
export const AuditLogPage = page(AuditLogEntry, 'AuditLogPage');

/** Recursively replace values of sensitive keys (used by the API and the mocks). */
export function redactAudit(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactAudit);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [
        k,
        AUDIT_REDACT_KEY.test(k) ? AUDIT_REDACTED : redactAudit(x),
      ]),
    );
  return v;
}
