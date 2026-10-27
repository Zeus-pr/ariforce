import * as z from 'zod';
import { UserRef, DateOnly, Id, Timestamp } from './common';

/** Leave management (#51). Policy lives in data (leave_settings, leave_policies), see docs/LEAVE.md. */
export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const LeaveStatus = z.enum(LEAVE_STATUSES).meta({
  id: 'LeaveStatus',
  description:
    'pending -> approved | rejected; pending or approved -> cancelled (balance restored). Applying submits straight to approval.',
});
export const LeaveHalf = z.enum(['am', 'pm']).meta({ id: 'LeaveHalf' });
export const LeaveCode = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,15}$/)
  .meta({ description: 'Leave type code, e.g. CL, SL, EL, LOP, COMP', example: 'CL' });
const Days = z.number().min(0).max(366).multipleOf(0.5);

export const LeaveType = z
  .object({
    code: LeaveCode,
    name: z.string(),
    paid: z.boolean(),
    annualQuota: Days.nullable().meta({ description: 'Days per calendar year; null = unlimited' }),
    carryForward: z.boolean(),
    carryForwardCap: Days.nullable().meta({ description: 'null = no cap' }),
    halfDayAllowed: z.boolean(),
    grantOnly: z.boolean().meta({ description: 'Balance only from grants (comp-off)' }),
    active: z.boolean(),
    sortOrder: z.int(),
    version: z.int(),
  })
  .meta({ id: 'LeaveType' });
export type LeaveType = z.infer<typeof LeaveType>;
export const LeaveTypeList = z.object({ items: z.array(LeaveType) }).meta({ id: 'LeaveTypeList' });
export const LeaveTypeUpdate = z
  .object({
    name: z.string().min(1).max(80).optional(),
    paid: z.boolean().optional(),
    annualQuota: Days.nullable().optional(),
    carryForward: z.boolean().optional(),
    carryForwardCap: Days.nullable().optional(),
    halfDayAllowed: z.boolean().optional(),
    grantOnly: z.boolean().optional(),
    active: z.boolean().optional(),
    sortOrder: z.int().min(0).max(100).optional(),
    version: z.int().min(1).optional(),
  })
  .meta({ id: 'LeaveTypeUpdate', description: 'PUT creates the type when the code is new' });

/** Backdating window for new companies (confirmed 14 days). The SQL column default from 0023 is 7; the API
 * always inserts this value when it creates a company's settings row and never overwrites an existing row. */
export const LEAVE_DEFAULT_BACKDATE_DAYS = 14;

export const LeaveSettings = z
  .object({
    approvalLevels: z.int().min(1).max(5),
    backdateDays: z.int().min(0).max(366),
    weeklyOffDays: z
      .array(z.int().min(0).max(6))
      .max(7)
      .meta({ description: '0 = Sunday .. 6 = Saturday; not counted as leave days' }),
    maxFutureDays: z
      .int()
      .min(0)
      .max(731)
      .nullable()
      .meta({ description: 'Latest start relative to today; null = up to 31 Dec this year' }),
    version: z.int(),
  })
  .meta({ id: 'LeaveSettings' });
export const LeaveSettingsUpdate = LeaveSettings.partial().meta({ id: 'LeaveSettingsUpdate' });

export const LeaveApply = z
  .object({
    typeCode: LeaveCode,
    fromDate: DateOnly,
    toDate: DateOnly,
    half: LeaveHalf.nullable().default(null).meta({ description: 'Half day; fromDate = toDate' }),
    reason: z.string().max(1000).nullable().default(null),
  })
  .refine((b) => b.toDate >= b.fromDate, { message: 'toDate before fromDate', path: ['toDate'] })
  .refine((b) => !b.half || b.fromDate === b.toDate, {
    message: 'Half day needs fromDate = toDate',
    path: ['half'],
  })
  .meta({ id: 'LeaveApply' });
export type LeaveApply = z.infer<typeof LeaveApply>;

export const LeaveRequest = z
  .object({
    id: Id,
    userId: Id,
    userName: z.string(),
    typeCode: LeaveCode,
    typeName: z.string(),
    paid: z.boolean(),
    year: z.int(),
    fromDate: DateOnly,
    toDate: DateOnly,
    half: LeaveHalf.nullable(),
    days: z.number().meta({ description: 'Counted days (weekly offs excluded; 0.5 for a half)' }),
    reason: z.string().nullable(),
    status: LeaveStatus,
    approvalId: Id.nullable(),
    approvalStep: z.int().nullable().meta({ description: 'Current step while pending' }),
    createdAt: Timestamp,
    decidedAt: Timestamp.nullable(),
    decidedBy: Id.nullable(),
    decisionComment: z.string().nullable(),
    rejectionReason: z.string().nullable().meta({
      description:
        'Why it was rejected (trimmed, required on reject); null unless status is rejected',
    }),
    rejectedBy: UserRef.nullable().meta({
      description: 'Who rejected it ({id, name}); null unless rejected',
    }),
    rejectedAt: Timestamp.nullable().meta({
      description: 'When it was rejected; null unless rejected',
    }),
    cancelledAt: Timestamp.nullable(),
    cancelledBy: Id.nullable(),
    cancelReason: z.string().nullable(),
    version: z.int(),
  })
  .meta({ id: 'LeaveRequest' });
export type LeaveRequest = z.infer<typeof LeaveRequest>;
export const LeaveRequestList = z
  .object({ items: z.array(LeaveRequest) })
  .meta({ id: 'LeaveRequestList' });
export const LeaveRequestQuery = z.object({
  userId: Id.optional(),
  status: LeaveStatus.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  from: DateOnly.optional().meta({ description: 'Requests ending on/after this date' }),
  to: DateOnly.optional().meta({ description: 'Requests starting on/before this date' }),
  mine: z.enum(['true', 'false']).optional().meta({ description: 'Only your own' }),
});
export const LeaveCancel = z
  .object({ reason: z.string().max(1000).nullable().default(null) })
  .meta({ id: 'LeaveCancel' });
export const LeaveDecision = z
  .object({
    decision: z.enum(['approve', 'reject']),
    comment: z.string().trim().max(1000).optional(),
  })
  .meta({ id: 'LeaveDecision' });

export const LeaveBalanceItem = z
  .object({
    typeCode: LeaveCode,
    typeName: z.string(),
    paid: z.boolean(),
    unlimited: z.boolean(),
    opening: z.number().meta({ description: 'Opening grants + carry-forward from last year' }),
    carriedForward: z.number(),
    quota: z.number().nullable().meta({ description: 'Annual quota (accrued); null = unlimited' }),
    granted: z.number().meta({ description: 'Comp-off grants and adjustments (+/-)' }),
    used: z.number().meta({ description: 'Approved days' }),
    pending: z.number().meta({ description: 'Days awaiting approval (held from available)' }),
    available: z.number().nullable().meta({ description: 'null = unlimited' }),
  })
  .meta({ id: 'LeaveBalanceItem' });
export const LeaveBalance = z
  .object({ userId: Id, year: z.int(), items: z.array(LeaveBalanceItem) })
  .meta({ id: 'LeaveBalance' });
export const LeaveBalanceQuery = z.object({
  userId: Id.optional().meta({ description: 'Default: you. Others need leave:approve over them' }),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const LEAVE_GRANT_KINDS = ['opening', 'grant', 'adjustment'] as const;
export const LeaveGrantCreate = z
  .object({
    userId: Id,
    typeCode: LeaveCode,
    year: z.int().min(2000).max(2100),
    kind: z.enum(LEAVE_GRANT_KINDS).default('grant'),
    days: z.number().min(-366).max(366).multipleOf(0.5),
    workedDate: DateOnly.nullable().default(null).meta({ description: 'Comp-off: day worked' }),
    reason: z.string().min(1).max(1000),
  })
  .refine((g) => g.days !== 0 && (g.kind === 'adjustment' || g.days > 0), {
    message: 'days must be > 0 (adjustment may be negative, never 0)',
    path: ['days'],
  })
  .meta({ id: 'LeaveGrantCreate' });
export const LeaveGrant = z
  .object({
    id: Id,
    userId: Id,
    typeCode: LeaveCode,
    year: z.int(),
    kind: z.enum(['opening', 'carry_forward', 'grant', 'adjustment']),
    days: z.number(),
    workedDate: DateOnly.nullable(),
    reason: z.string().nullable(),
    grantedBy: Id.nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'LeaveGrant' });
export const LeaveGrantList = z
  .object({ items: z.array(LeaveGrant) })
  .meta({ id: 'LeaveGrantList' });
export const LeaveGrantQuery = z.object({
  userId: Id.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export const LeaveCarryForward = z
  .object({ fromYear: z.int().min(2000).max(2099) })
  .meta({ id: 'LeaveCarryForward' });
export const LeaveCarryForwardResult = z
  .object({ fromYear: z.int(), toYear: z.int(), written: z.int(), totalDays: z.number() })
  .meta({ id: 'LeaveCarryForwardResult' });

export const LeaveCalendarQuery = z.object({
  from: DateOnly,
  to: DateOnly,
  userId: Id.optional(),
  includePending: z.enum(['true', 'false']).optional(),
});
export const LeaveCalendarEntry = z
  .object({
    requestId: Id,
    userId: Id,
    userName: z.string(),
    typeCode: LeaveCode,
    status: z.enum(['pending', 'approved']),
    fromDate: DateOnly,
    toDate: DateOnly,
    half: LeaveHalf.nullable(),
    dates: z.array(DateOnly).meta({ description: 'Counted leave dates inside from..to' }),
  })
  .meta({ id: 'LeaveCalendarEntry' });
export const LeaveCalendar = z
  .object({ from: DateOnly, to: DateOnly, items: z.array(LeaveCalendarEntry) })
  .meta({ id: 'LeaveCalendar' });
