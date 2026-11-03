import * as z from 'zod';
import { DcrBand, DcrDetails, DcrSfcRoute, DcrExpenses } from './dcr-parts';
import { UserRef, DateOnly, GeoPoint, Id, Month, Syncable, Timestamp, listQuery } from './common';
import { RoleKey } from './roles';
import { ExpenseApprovalLevel, ExpenseApprover } from './expenses';

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
  doctorId: Id.optional().meta({
    description:
      'Doctor 360: only visit check-ins at this doctor (same as outletKind=doctor&outletId=). Still limited to the caller and their reporting line; combine with limit',
  }),
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
    primaryRole: RoleKey.nullable()
      .optional()
      .meta({ description: 'Highest-ranked role (the one the UI shows)' }),
    rank: z
      .int()
      .optional()
      .meta({ description: 'ROLE_RANK of primaryRole: BM 1 … director 8; functional roles 0' }),
    managerId: Id.nullable(),
    managerName: z.string().nullable().optional(),
    territoryIds: z.array(Id),
    territories: z
      .array(z.object({ id: Id, name: z.string(), code: z.string().nullable(), level: z.string() }))
      .optional()
      .meta({ description: 'Same as territoryIds, primary first' }),
    status: z.enum(['invited', 'active', 'suspended', 'pending', 'rejected']),
    version: z.int().optional().meta({ description: 'Send back on PATCH /v1/employees/{id}' }),
    lastActiveAt: Timestamp.nullable().optional().meta({
      description:
        'Last activity of a live session (null when signed out everywhere or never signed in)',
    }),
    hasLogin: z
      .boolean()
      .optional()
      .meta({ description: 'True once the person has a sign-in (invite accepted or linked)' }),
    inviteStatus: z.enum(['none', 'pending', 'expired', 'accepted']).optional().meta({
      description:
        'accepted = has a login; pending/expired = latest open invite; none = never invited or invite revoked',
    }),
    inviteExpiresAt: z.iso
      .datetime()
      .nullable()
      .optional()
      .meta({ description: 'Expiry of the latest open (unused, unrevoked) invite' }),
  })
  .meta({ id: 'UserSummary' });
export type UserSummary = z.infer<typeof UserSummary>;
export const UserListQuery = listQuery(['name', 'employeeCode'] as const, {
  role: RoleKey.optional(),
  managerId: Id.optional().meta({ description: 'Direct reports of this user' }),
  territoryId: Id.optional().meta({ description: 'Users assigned in this territory subtree' }),
  status: z.enum(['invited', 'active', 'suspended', 'pending', 'rejected']).optional(),
  hasLogin: z.enum(['true', 'false']).optional(),
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
export const TourPlanDayStatus = z.enum(['draft', 'submitted', 'approved', 'rejected']).meta({
  id: 'TourPlanDayStatus',
  description:
    'Status of the latest submission holding the day (#86); draft when none, or when a rejected day has no entries left',
});
export const TourPlanDay = z
  .object({
    date: DateOnly,
    entries: z.array(TourPlanEntry).max(3),
    status: TourPlanDayStatus.optional().meta({
      description: 'Response only (ignored on input). submitted/approved days are locked',
    }),
    submissionId: Id.nullable().optional().meta({
      description: 'Response only: the submission that set `status` (null for draft)',
    }),
  })
  .meta({ id: 'TourPlanDay' });

export const TourPlanSubmission = z
  .object({
    id: Id,
    tourPlanId: Id,
    dates: z.array(DateOnly).min(1),
    status: z.enum(['submitted', 'approved', 'rejected']),
    approvalId: Id.nullable().meta({
      description: 'Its approval request (GET /v1/approvals/{id})',
    }),
    submitterNote: z.string().nullable(),
    submittedAt: Timestamp,
    decidedAt: Timestamp.nullable(),
    decidedBy: UserRef.nullable(),
    decisionComment: z.string().nullable(),
    rejectionReason: z.string().nullable(),
    rejectedBy: UserRef.nullable(),
    rejectedAt: Timestamp.nullable(),
  })
  .meta({ id: 'TourPlanSubmission' });
export type TourPlanSubmission = z.infer<typeof TourPlanSubmission>;

export const TourPlan = Syncable.extend({
  userId: Id,
  month: Month,
  kind: z.enum(['stp', 'mtp']).meta({ description: 'Standard (template) or monthly plan' }),
  status: ApprovalStatus.meta({
    description:
      'Aggregate of the day statuses (#86): submitted if any submission is pending, else rejected if any day is rejected, else draft if any planned day is unsubmitted, else approved if any day is approved, else draft',
  }),
  days: z.array(TourPlanDay),
  submissions: z.array(TourPlanSubmission).optional().meta({
    description: 'All submissions of this plan, oldest first (#86)',
  }),
  submittedAt: Timestamp.nullable(),
  decidedAt: Timestamp.nullable(),
  decidedBy: Id.nullable(),
  decisionComment: z.string().nullable(),
  submitterNote: z.string().nullable().optional().meta({
    description: 'Note from the submitter to the approver (POST submit body); cleared on edit',
  }),
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
}).meta({ id: 'TourPlan' });
export type TourPlan = z.infer<typeof TourPlan>;
export const TourPlanCalendar = z
  .object({
    month: Month,
    todayIST: DateOnly.meta({ description: 'Today in Asia/Kolkata' }),
    weeklyOffDays: z
      .array(z.int().min(0).max(6))
      .meta({ description: 'From leave settings (0 = Sunday .. 6 = Saturday); default [0]' }),
    days: z
      .array(z.object({ date: DateOnly, status: TourPlanDayStatus, submissionId: Id.nullable() }))
      .optional()
      .meta({ description: 'Days present in the plan with their own status (#86)' }),
    requiredDates: z.array(DateOnly).meta({
      description:
        'Informational only (kept for compatibility): non-off dates; current month only from todayIST on. Submit does not require them; it only needs one planned day.',
    }),
  })
  .meta({ id: 'TourPlanCalendar' });
export const TourPlanSubmit = z
  .object({
    submitterNote: z.string().trim().max(1000).nullable().optional(),
    dates: z.array(DateOnly).min(1).max(31).optional().meta({
      description:
        'Days to submit together (#86). Default: every planned day that is draft or rejected. Days without entries are skipped; none left = 422 EMPTY_PLAN; a submitted/approved day = 409 DAY_LOCKED',
    }),
  })
  .meta({ id: 'TourPlanSubmit' });
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
    value: z.number().min(0).nullable().optional().meta({
      description:
        'INR = quantity × product PTS (price to stockist), computed by the server when the line is saved and kept as saved (null when the product has no PTS). Ignored on input.',
    }),
  })
  .meta({
    id: 'PobLine',
    description:
      'Personal order booking line: chemist and stockist calls only (doctor calls: 422 VALIDATION, details.reason POB_NOT_ALLOWED_FOR_DOCTOR); one line per product per call',
  });
/** Brand names are trimmed and inner whitespace collapsed before storage and comparison. */
const BrandName = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, ' '))
  .pipe(z.string().min(1).max(100));
export const RcpaLine = z
  .object({
    productId: Id.meta({ description: 'Our product; anchors the molecule being audited' }),
    competitorBrand: BrandName.nullable()
      .optional()
      .meta({ description: 'Null/absent = this line counts our own brand' }),
    competitorCompany: BrandName.nullable().optional(),
    quantity: z.int().min(1).max(100000).meta({ description: 'Units sold/seen at the chemist' }),
    prescriptions: z.int().min(0).max(100000).nullable().optional().meta({
      description: 'Prescription (Rx) count, if captured',
    }),
    doctorId: Id.nullable().optional().meta({ description: 'Prescribing doctor, in your scope' }),
  })
  .refine((l) => !l.competitorCompany || l.competitorBrand, {
    message: 'competitorCompany needs competitorBrand',
    path: ['competitorCompany'],
  })
  .meta({
    id: 'RcpaLine',
    description: 'Retail chemist prescription audit line (chemist calls, #40)',
  });

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
    rcpa: z.array(RcpaLine),
    remarks: z.string().max(1000).nullable(),
    presentationOpenedAt: Timestamp.nullable().default(null).meta({
      description:
        'When the product presentation was shown to the doctor (client time). Drafts may omit it; submit requires it on every doctor call with productsDetailed (422 VALIDATION, details.reason PRESENTATION_NOT_OPENED).',
    }),
    calledAt: Timestamp.meta({
      readOnly: true,
      description:
        'Server time when the call (clientId) was first saved to a DCR; never changes on re-save. Client values are ignored.',
    }),
  })
  .meta({ id: 'DcrCall' });
export type DcrCall = z.infer<typeof DcrCall>;
export const DcrCallInput = DcrCall.omit({ id: true })
  .extend({
    clientId: Id,
    pob: z.array(PobLine).max(100),
    rcpa: z.array(RcpaLine).max(100).default([]),
    presentationOpenedAt: Timestamp.nullable().optional().meta({
      description: 'See DcrCall.presentationOpenedAt; omit or null on drafts',
    }),
    calledAt: Timestamp.optional().meta({
      description: 'Ignored: the server sets calledAt when the call is first saved',
    }),
  })
  .meta({ id: 'DcrCallInput' });
export const CompetitorBrandQuery = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const CompetitorBrand = z
  .object({
    brand: z.string(),
    company: z.string().nullable().meta({ description: 'Most-used company for this brand' }),
    uses: z.int(),
  })
  .meta({ id: 'CompetitorBrand' });
export const CompetitorBrandList = z
  .object({ items: z.array(CompetitorBrand) })
  .meta({ id: 'CompetitorBrandList' });

export const Dcr = Syncable.extend({
  userId: Id,
  date: DateOnly,
  workTypeId: Id,
  territoryIds: z.array(Id),
  tourPlanId: Id.nullable(),
  tourPlanItemId: Id.nullable()
    .optional()
    .meta({ description: 'Approved TourPlanItem this report was filed from' }),
  deviationReason: z
    .string()
    .max(500)
    .nullable()
    .meta({ description: 'Required when worked differs from the approved TP (#22)' }),
  status: z.enum(['draft', 'submitted', 'locked', 'approved', 'rejected']).meta({
    description:
      "draft/submitted show 'locked' after the day-lock cut-off (#23). approved/rejected (manager review) always show as such.",
  }),
  reviewStatus: z.enum(['pending', 'approved', 'rejected']).nullable().default(null).meta({
    description: 'Manager review: pending = submitted, not reviewed yet; null for drafts',
  }),
  approvedAt: Timestamp.nullable().default(null),
  approvedBy: Id.nullable().default(null).meta({
    description: 'Reviewer; null with approvedAt set = approved by the system (autoApproved)',
  }),
  autoApproved: z.boolean().optional().meta({
    description:
      "True when the system approved it at submit: the filer is a director (no manager). Audited dcr.auto_approved with reason 'auto-approved, no manager'",
  }),
  neverLocks: z.boolean().optional().meta({
    description:
      'True for a director: the day never locks (no 00:00 IST lock, no unlock request needed); status never becomes locked',
  }),
  rejectedAt: Timestamp.nullable().default(null),
  rejectedBy: Id.nullable().default(null),
  rejectionReason: z.string().max(500).nullable().default(null).meta({
    description:
      'Why the manager rejected it. A rejected DCR is kept for history, counts nowhere, and reopens its day for 48 h (unlockedUntil).',
  }),
  calls: z.array(DcrCall),
  submittedAt: Timestamp.nullable(),
  lockAt: Timestamp.meta({
    description:
      'Day-lock cut-off: 00:00 Asia/Kolkata on the next day (submit by 23:59 IST the same day)',
  }),
  unlockedUntil: Timestamp.nullable().meta({
    description:
      'Set while an approved correction request or a manager rejection keeps a locked day editable (48 h from the decision)',
  }),
  band: DcrBand.nullable()
    .default(null)
    .meta({ description: 'Field-day band (from the work type); null for non-field days' }),
  details: DcrDetails.nullable().default(null),
  workWithUserIds: z.array(Id).default([]).meta({ description: 'Day-level Work With (anyone)' }),
  sfcRoutes: z
    .array(DcrSfcRoute)
    .default([])
    .meta({ description: 'One chosen SFC route per HQ of the day; snapshots set at submit' }),
  submittedBy: Id.nullable().default(null),
  expenses: DcrExpenses.optional().meta({
    description:
      'Expenses reported for the day (any work type). Linked into the month claim at submit (origin dcr); read-only after submit. Absent (older API) = none',
  }),
  expenseClaimId: Id.nullable().optional().meta({
    description:
      "Month claim holding this DCR's expense lines (origin dcr); null when it has none. Absent from older APIs",
  }),
  expenseTotal: z
    .number()
    .optional()
    .meta({ description: "Sum of this DCR's live origin-dcr claim lines, rupees (0 when none)" }),
  expenseCount: z
    .int()
    .min(0)
    .optional()
    .meta({ description: "Number of this DCR's live origin-dcr claim lines (0 when none)" }),
  callCount: z
    .int()
    .min(0)
    .optional()
    .meta({ description: 'Live calls on this DCR (GET /v1/dcrs list only)' }),
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
  doctorId: Id.optional().meta({
    description:
      'Doctor 360: only DCRs with at least one (non-deleted) call at this doctor. Same user scope as without it (own, or reporting line for dcr:review); combine with limit',
  }),
  status: z.enum(['draft', 'submitted', 'locked', 'approved', 'rejected']).optional(),
  mine: z.enum(['true', 'false']).optional().meta({
    description:
      "true: only the caller's own DCRs (ignores userId). Otherwise callers with dcr:review see their team (approvals hierarchy, incl. themselves); everyone else sees only their own",
  }),
});

/** Manager review of a submitted DCR (dcr:review): POST /v1/dcrs/{id}/decision. */
export const DcrDecision = z
  .object({
    decision: z.enum(['approve', 'reject']),
    comment: z.string().trim().max(500).optional().meta({
      description: 'Required (1-500 chars) to reject; stored as Dcr.rejectionReason',
    }),
  })
  .refine((b) => b.decision === 'approve' || (b.comment?.length ?? 0) >= 1, {
    message: 'comment is required to reject',
    path: ['comment'],
  })
  .meta({ id: 'DcrDecision' });

// ---- Approvals (#17) ----
export const Approval = z
  .object({
    id: Id,
    companyId: Id,
    subjectType: z
      .enum([
        'tour_plan',
        'doctor',
        'chemist',
        'stockist',
        'dcr_unlock',
        'leave',
        'device',
        'expense',
        'dcr',
        'signup',
      ])
      .meta({
        description:
          "Engine types; 'dcr' (DCR review, subjectId = DCR id) and 'signup' (signup request) are only returned when asked for with include=dcr / include=signup",
      }),
    subjectId: Id,
    canDecide: z.boolean().optional().meta({
      description:
        'True when the caller can decide this request now (pending, not their own, approvals:decide plus the type permission: dcr_unlock:decide for dcr_unlock, expenses:approve for expense; in line above the current approver)',
    }),
    requestedBy: Id,
    requestedByName: z.string(),
    approverId: Id.nullable().meta({
      description:
        'Reporting manager; null = any authorised manager. dcr_unlock: the company director (dcr_unlock:decide holder) when there is exactly one; null when several share the queue',
    }),
    status: z.enum(['pending', 'approved', 'rejected', 'cancelled']),
    summary: z.string(),
    comment: z.string().nullable(),
    createdAt: Timestamp,
    decidedAt: Timestamp.nullable(),
    decidedBy: Id.nullable(),
    rejectionReason: z.string().nullable().optional().meta({
      description: 'The reason of the rejecting step; null unless status is rejected',
    }),
    autoApproved: z.boolean().optional().meta({
      description:
        "True when the system approved it at submit (the requester is a director, no manager): decidedBy null, comment 'auto-approved, no manager'",
    }),
    flags: z
      .array(z.enum(['dcr_rejected_lines']))
      .optional()
      .meta({
        description:
          'Approver warnings. dcr_rejected_lines: an expense claim has lines on days whose DCR was rejected (see claim.dcrRejectedDates); approving such a claim is blocked with 409 DCR_NOT_APPROVED',
      }),
  })
  .extend({
    requestedByRole: RoleKey.nullable().optional().meta({
      description: "Requester's most senior role key",
    }),
    level: z.int().min(1).nullable().optional().meta({
      description: 'Level awaiting a decision (1-based); null once decided',
    }),
    totalLevels: z.int().min(1).nullable().optional().meta({
      description: 'Configured levels for this type; null where the type has a single decision',
    }),
    currentApprover: ExpenseApprover.nullable().optional().meta({
      description: 'Approver of the level awaiting a decision; null when decided or shared queue',
    }),
    trail: z.array(ExpenseApprovalLevel).optional().meta({
      description:
        'Per-level history (same shape as ExpenseClaim.approvalTrail): who, when, status, comment/reason. Present on scope=org reads',
    }),
  })
  .meta({ id: 'Approval' });
export type Approval = z.infer<typeof Approval>;
export const ApprovalDecision = z
  .object({
    decision: z.enum(['approve', 'reject']),
    comment: z.string().trim().max(1000).optional().meta({
      description:
        'Trimmed. Required to reject: missing, blank or whitespace-only gives 422 REJECTION_REASON_REQUIRED',
    }),
  })
  .meta({ id: 'ApprovalDecision' });
export const ApprovalListQuery = listQuery(['createdAt'] as const, {
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  subjectType: Approval.shape.subjectType.optional(),
  mine: z.enum(['to_decide', 'requested']).optional().meta({
    description:
      'to_decide = pending requests from your reporting line that you may decide (never your own); requested = yours',
  }),
  scope: z.enum(['org']).optional().meta({
    description:
      'org: every request of your reporting subtree in any state (Director: the whole company), with trail/level fields. Needs approvals:decide (else 403). Ignored with mine',
  }),
  userId: Id.optional().meta({ description: 'Requester; must be you or in your subtree' }),
  from: DateOnly.optional().meta({ description: 'Created on/after this IST date' }),
  to: DateOnly.optional().meta({ description: 'Created on/before this IST date' }),
  include: z
    .string()
    .regex(/^(dcr|signup)(,(dcr|signup))?$/)
    .optional()
    .meta({
      description:
        'Comma list of non-engine items to merge in: dcr (DCR reviews: submitted/approved/rejected DCRs, needs dcr:review) and signup (signup requests, same visibility as GET /v1/signup-requests). Only with scope=org',
    }),
}).meta({ description: 'Visible: your own requests and those of your reporting line' });
