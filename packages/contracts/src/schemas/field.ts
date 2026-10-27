import * as z from 'zod';
import { DateOnly, GeoPoint, Id, Month, Syncable, Timestamp, listQuery } from './common';
import { RoleKey } from './roles';

const Capture = z.object({
  location: GeoPoint,
  accuracyM: z.number().min(0).max(10000),
  capturedAt: Timestamp.meta({ description: 'Device clock at capture' }),
  isMock: z.boolean().default(false).meta({ description: 'Mock-location flag from the OS' }),
});

/** GPS is captured only at these moments. No continuous tracking. */
export const CheckInKind = z.enum(['punch_in', 'visit', 'punch_out']).meta({ id: 'CheckInKind' });
export const OutletKind = z.enum(['doctor', 'chemist', 'stockist']).meta({ id: 'OutletKind' });

export const CheckIn = Syncable.extend({
  userId: Id,
  territoryId: Id.nullable(),
  date: DateOnly,
  kind: CheckInKind,
  outletKind: OutletKind.nullable(),
  outletId: Id.nullable(),
  ...Capture.shape,
  receivedAt: Timestamp,
  distanceM: z.number().nullable().meta({ description: 'Distance to the outlet geo-tag' }),
  inFence: z
    .boolean()
    .nullable()
    .meta({ description: 'Within the geofence radius; null if outlet not geo-tagged' }),
  selfieFileKey: z
    .string()
    .nullable()
    .meta({ description: 'R2 key (upload purpose visit_attachment)' }),
}).meta({ id: 'CheckIn' });
export type CheckIn = z.infer<typeof CheckIn>;

export const CheckInCreate = z
  .object({
    clientId: Id.meta({ description: 'Client-generated UUIDv7 (offline idempotency)' }),
    kind: CheckInKind,
    outletKind: OutletKind.optional(),
    outletId: Id.optional(),
    selfieFileKey: z.string().max(300).optional(),
    deviceId: Id.optional().meta({
      description: 'Enrolled device; may be omitted when the user has exactly one active device',
    }),
    ...Capture.shape,
  })
  .refine((b) => b.kind !== 'visit' || (b.outletKind && b.outletId), {
    message: 'visit requires outletKind and outletId',
    path: ['outletId'],
  })
  .meta({ id: 'CheckInCreate' });
export type CheckInCreate = z.infer<typeof CheckInCreate>;

export const FieldListQuery = listQuery(['date', 'createdAt', 'updatedAt'] as const, {
  from: DateOnly.optional(),
  to: DateOnly.optional(),
  userId: Id.optional().meta({ description: 'Must be the caller or someone in their team' }),
  territoryId: Id.optional().meta({ description: 'Territory incl. descendants' }),
});
export const CheckInListQuery = FieldListQuery.extend({
  kind: CheckInKind.optional(),
  outletKind: OutletKind.optional(),
  outletId: Id.optional(),
  unlinked: z.enum(['true', 'false']).optional().meta({
    description:
      'true = only visit check-ins not yet linked to a DCR call (DCR call picker, gap #9)',
  }),
});

// ---- Users (team directory, gap #3) ----
export const UserSummary = z
  .object({
    id: Id,
    name: z.string(),
    email: z.string(),
    employeeCode: z.string().nullable(),
    phone: z.string().nullable().optional(),
    designation: z.string().nullable().optional(),
    joinedOn: z.iso.date().nullable().optional(),
    roles: z.array(RoleKey),
    managerId: Id.nullable(),
    territoryIds: z.array(Id),
    status: z.enum(['invited', 'active', 'suspended', 'pending', 'rejected']),
  })
  .meta({ id: 'UserSummary' });
export type UserSummary = z.infer<typeof UserSummary>;
export const UserListQuery = listQuery(['name', 'employeeCode'] as const, {
  role: RoleKey.optional(),
  managerId: Id.optional().meta({ description: 'Direct reports of this user' }),
  territoryId: Id.optional().meta({ description: 'Users assigned in this territory subtree' }),
  status: z.enum(['invited', 'active', 'suspended', 'pending', 'rejected']).optional(),
}).meta({ description: 'Caller plus their reporting line; company-wide roles see everyone' });

export const AttendanceDay = z
  .object({
    userId: Id,
    userName: z.string(),
    date: DateOnly,
    status: z.enum(['present', 'absent', 'leave', 'holiday', 'incomplete']),
    punchIn: CheckIn.nullable(),
    punchOut: CheckIn.nullable(),
    visits: z.int().min(0),
    workTypeId: Id.nullable(),
    leave: z
      .object({ requestId: Id, typeCode: z.string(), half: z.enum(['am', 'pm']).nullable() })
      .nullable()
      .meta({
        description:
          'Approved leave on this day (#51); with no punch-in the status is leave, not absent',
      }),
  })
  .meta({ id: 'AttendanceDay' });
export type AttendanceDay = z.infer<typeof AttendanceDay>;

export const GeofenceSettings = z
  .object({
    radiusM: z.int().min(10).max(5000).meta({ description: 'Default visit geofence radius (#24)' }),
    maxAccuracyM: z.int().min(5).max(5000),
    blockOutOfFence: z.boolean().meta({ description: 'false = allow and flag' }),
    blockMockLocation: z.boolean(),
    version: z.int().min(1),
  })
  .meta({ id: 'GeofenceSettings' });
export type GeofenceSettings = z.infer<typeof GeofenceSettings>;

/** DPDP consent state for the caller's device (#36). */
export const ConsentState = z
  .object({
    deviceId: Id.nullable(),
    ownership: z.enum(['company', 'personal']).nullable(),
    currentNoticeVersion: z.string(),
    noticeUrl: z.string(),
    consents: z.array(
      z.object({
        purpose: z.enum(['personal_device_enrolment', 'location_checkin']),
        granted: z.boolean(),
        noticeVersion: z.string(),
        at: Timestamp,
      }),
    ),
    canCheckIn: z.boolean().meta({ description: 'False until required consents are granted' }),
  })
  .meta({ id: 'ConsentState' });
export type ConsentState = z.infer<typeof ConsentState>;

// ---- Tour plan (#11, #20, #21) ----
export const ApprovalStatus = z
  .enum(['draft', 'submitted', 'approved', 'rejected', 'recalled'])
  .meta({ id: 'ApprovalStatus' });

export const TourPlanEntry = z
  .object({
    session: z.enum(['full', 'am', 'pm']).meta({ description: 'Multi-session days (#21)' }),
    workTypeId: Id,
    territoryIds: z.array(Id).meta({ description: 'Patches/territories to work' }),
    jointWorkUserIds: z.array(Id).default([]),
    plannedDoctorIds: z.array(Id).default([]),
    plannedChemistIds: z.array(Id).default([]),
    notes: z.string().max(500).nullable().optional(),
  })
  .meta({ id: 'TourPlanEntry' });
export const TourPlanDay = z
  .object({ date: DateOnly, entries: z.array(TourPlanEntry).max(3) })
  .meta({ id: 'TourPlanDay' });

export const TourPlan = Syncable.extend({
  userId: Id,
  month: Month,
  kind: z.enum(['stp', 'mtp']).meta({ description: 'Standard (template) or monthly plan' }),
  status: ApprovalStatus,
  days: z.array(TourPlanDay),
  submittedAt: Timestamp.nullable(),
  decidedAt: Timestamp.nullable(),
  decidedBy: Id.nullable(),
  decisionComment: z.string().nullable(),
}).meta({ id: 'TourPlan' });
export type TourPlan = z.infer<typeof TourPlan>;
export const TourPlanCalendar = z
  .object({
    month: Month,
    todayIST: DateOnly.meta({ description: 'Today in Asia/Kolkata' }),
    weeklyOffDays: z
      .array(z.int().min(0).max(6))
      .meta({ description: 'From leave settings (0 = Sunday .. 6 = Saturday); default [0]' }),
    requiredDates: z.array(DateOnly).meta({
      description:
        'Dates submit needs an entry on: non-off dates; current month only from todayIST on. Full-day approved leave is also exempt at submit.',
    }),
  })
  .meta({ id: 'TourPlanCalendar' });
export const TourPlanUpsert = z
  .object({ days: z.array(TourPlanDay), version: z.int().min(1).optional() })
  .meta({ id: 'TourPlanUpsert' });
export const TourPlanCopy = z
  .object({
    fromMonth: Month.optional().meta({
      description: 'Copy this month (same week + weekday); wins over fromStp',
    }),
    fromStp: z.boolean().default(true).meta({
      description: 'true = copy the standard plan; false (no fromMonth) = copy the previous month',
    }),
  })
  .meta({
    id: 'TourPlanCopy',
    description:
      'Fills a draft (new, draft or rejected plan) from the STP or another month (#20). Dates map by week of month + weekday.',
  });

/** Standard tour plan (STP): weekly pattern by week of month (1-5) and ISO weekday (Mon=1). */
export const StandardTourPlanDay = z
  .object({
    week: z.int().min(1).max(5),
    weekday: z.int().min(1).max(7),
    entries: z.array(TourPlanEntry).max(3),
  })
  .meta({ id: 'StandardTourPlanDay' });
export const StandardTourPlan = Syncable.extend({
  userId: Id,
  days: z.array(StandardTourPlanDay),
}).meta({ id: 'StandardTourPlan' });
export type StandardTourPlan = z.infer<typeof StandardTourPlan>;
export const StandardTourPlanUpsert = z
  .object({ days: z.array(StandardTourPlanDay).max(35), version: z.int().min(1).optional() })
  .meta({ id: 'StandardTourPlanUpsert' });
export const TourPlanListQuery = FieldListQuery.extend({
  month: Month.optional(),
  status: ApprovalStatus.optional(),
});

// ---- DCR (#10, #18, #22, #23) ----
export const DetailedProduct = z
  .object({
    productId: Id,
    order: z.int().min(1).meta({ description: 'Detailing sequence' }),
    feedback: z.enum(['positive', 'neutral', 'negative']).nullable().optional(),
  })
  .meta({ id: 'DetailedProduct' });
export const SampleGiven = z
  .object({ productId: Id, quantity: z.int().min(1).max(10000) })
  .meta({ id: 'SampleGiven' });
export const PobLine = z
  .object({
    productId: Id,
    quantity: z.int().min(1),
    stockistId: Id.nullable().optional(),
    value: z.number().min(0).nullable().optional().meta({ description: 'INR, at PTR' }),
  })
  .meta({ id: 'PobLine', description: 'Personal order booking line' });

export const DcrCall = z
  .object({
    id: Id,
    outletKind: OutletKind,
    outletId: Id,
    checkInId: Id.nullable().meta({ description: 'Visit check-in (GPS) for this call' }),
    jointWorkUserIds: z.array(Id),
    productsDetailed: z.array(DetailedProduct),
    samples: z.array(SampleGiven),
    pob: z.array(PobLine),
    remarks: z.string().max(1000).nullable(),
    calledAt: Timestamp,
  })
  .meta({ id: 'DcrCall' });
export type DcrCall = z.infer<typeof DcrCall>;
export const DcrCallInput = DcrCall.omit({ id: true })
  .extend({ clientId: Id })
  .meta({ id: 'DcrCallInput' });

export const Dcr = Syncable.extend({
  userId: Id,
  date: DateOnly,
  workTypeId: Id,
  territoryIds: z.array(Id),
  tourPlanId: Id.nullable(),
  deviationReason: z
    .string()
    .max(500)
    .nullable()
    .meta({ description: 'Required when worked differs from the approved TP (#22)' }),
  status: z
    .enum(['draft', 'submitted', 'locked'])
    .meta({ description: 'Locked after the day-lock cut-off (#23)' }),
  calls: z.array(DcrCall),
  submittedAt: Timestamp.nullable(),
  lockAt: Timestamp.meta({
    description:
      'Day-lock cut-off: end of the day + companies.dcr_lock_after_hours (company time zone)',
  }),
  unlockedUntil: Timestamp.nullable().meta({
    description: 'Set while an approved correction request keeps a locked day editable (48 h)',
  }),
}).meta({ id: 'Dcr' });
export type Dcr = z.infer<typeof Dcr>;
export const DcrUpsert = z
  .object({
    date: DateOnly,
    workTypeId: Id,
    territoryIds: z.array(Id),
    deviationReason: z.string().max(500).nullable().optional(),
    calls: z.array(DcrCallInput).max(60),
    submit: z.boolean().default(false),
    version: z.int().min(1).optional(),
  })
  .meta({ id: 'DcrUpsert' });
/** Ask the manager to reopen a locked day (gap #8); approval keeps it editable for 48 h. */
export const DcrCorrectionRequest = z
  .object({ date: DateOnly, reason: z.string().min(3).max(500) })
  .meta({ id: 'DcrCorrectionRequest' });
export const DCR_UNLOCK_HOURS = 48;
export const DcrListQuery = FieldListQuery.extend({
  status: z.enum(['draft', 'submitted', 'locked']).optional(),
});

// ---- Approvals (#17) ----
export const Approval = z
  .object({
    id: Id,
    companyId: Id,
    subjectType: z.enum([
      'tour_plan',
      'doctor',
      'chemist',
      'stockist',
      'dcr_unlock',
      'leave',
      'device',
      'expense',
    ]),
    subjectId: Id,
    requestedBy: Id,
    requestedByName: z.string(),
    approverId: Id.nullable().meta({
      description: 'Reporting manager; null = any authorised manager',
    }),
    status: z.enum(['pending', 'approved', 'rejected', 'cancelled']),
    summary: z.string(),
    comment: z.string().nullable(),
    createdAt: Timestamp,
    decidedAt: Timestamp.nullable(),
    decidedBy: Id.nullable(),
  })
  .meta({ id: 'Approval' });
export type Approval = z.infer<typeof Approval>;
export const ApprovalDecision = z
  .object({
    decision: z.enum(['approve', 'reject']),
    comment: z.string().max(1000).optional(),
  })
  .refine((d) => d.decision === 'approve' || !!d.comment, {
    message: 'comment required to reject',
    path: ['comment'],
  })
  .meta({ id: 'ApprovalDecision' });
export const ApprovalListQuery = listQuery(['createdAt'] as const, {
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  subjectType: Approval.shape.subjectType.optional(),
  mine: z.enum(['to_decide', 'requested']).optional().meta({
    description:
      'to_decide = pending requests from your reporting line that you may decide (never your own); requested = yours',
  }),
}).meta({ description: 'Visible: your own requests and those of your reporting line' });
