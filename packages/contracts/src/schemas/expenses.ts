import * as z from 'zod';
import { UserRef, DateOnly, Id, Month, Timestamp } from './common';

/** Expense claims (#52): one claim per user per month, lines with receipts in R2. */
/** `allowance` = daily allowance (DA), usually drafted by TA/DA auto-calc (#39). */
export const EXPENSE_CATEGORIES = [
  'travel',
  'hotel',
  'food',
  'mileage',
  'allowance',
  'other',
] as const;
export const ExpenseCategory = z.enum(EXPENSE_CATEGORIES).meta({ id: 'ExpenseCategory' });
export const EXPENSE_STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'paid'] as const;
export const ExpenseStatus = z.enum(EXPENSE_STATUSES).meta({
  id: 'ExpenseStatus',
  description:
    'draft -> submitted -> approved -> paid; submitted -> rejected -> (edit) -> submitted again',
});

/** Receipt allow-list: content type -> allowed file extensions (lower case, no dot). */
export const EXPENSE_FILE_TYPES = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/heic': ['heic'],
  'image/heif': ['heif', 'heic'],
  'application/pdf': ['pdf'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-excel': ['xls'],
  'text/csv': ['csv'],
} as const;
export type ExpenseContentType = keyof typeof EXPENSE_FILE_TYPES;
export const EXPENSE_CONTENT_TYPES = Object.keys(EXPENSE_FILE_TYPES) as [
  ExpenseContentType,
  ...ExpenseContentType[],
];
export const EXPENSE_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const EXPENSE_MAX_FILES_PER_LINE = 5;
/** Amount in rupees with 2 decimals (sent and returned as a number). */
const Amount = z.number().positive().max(10_000_000).multipleOf(0.01);

/** Extension of a file name (lower case) or ''. */
export const fileExt = (name: string) => /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? '';

export const ExpenseLineInput = z
  .object({
    date: DateOnly,
    category: ExpenseCategory,
    amount: Amount,
    notes: z.string().max(1000).nullable().default(null),
    mileageKm: z.number().positive().max(5000).nullable().default(null).meta({
      description: 'Required for mileage, not allowed otherwise',
    }),
    dcrId: Id.nullable().default(null).meta({ description: 'Your DCR for the same date' }),
    tourPlanId: Id.nullable().default(null).meta({ description: 'Your tour plan for the month' }),
  })
  .refine((l) => (l.category === 'mileage') === (l.mileageKm !== null), {
    message: 'mileageKm is required for mileage lines and only for them',
    path: ['mileageKm'],
  })
  .meta({ id: 'ExpenseLineInput' });
export type ExpenseLineInput = z.infer<typeof ExpenseLineInput>;

export const ExpenseAttachment = z
  .object({
    id: Id,
    lineId: Id,
    contentType: z.enum(EXPENSE_CONTENT_TYPES),
    sizeBytes: z.int(),
    status: z.enum(['pending', 'confirmed']),
    createdAt: Timestamp,
    confirmedAt: Timestamp.nullable(),
  })
  .meta({
    id: 'ExpenseAttachment',
    description: 'No file name or key is exposed; fetch bytes with download-url',
  });

export const ExpenseLine = z
  .object({
    id: Id,
    claimId: Id,
    date: DateOnly,
    category: ExpenseCategory,
    amount: z.number(),
    notes: z.string().nullable(),
    mileageKm: z.number().nullable(),
    dcrId: Id.nullable(),
    tourPlanId: Id.nullable(),
    source: z.enum(['manual', 'auto']).meta({
      description:
        'auto = drafted by TA/DA (#39) and replaced on re-run; editing or attaching a receipt makes it manual',
    }),
    allowancePlaceId: Id.nullable().meta({ description: 'Fare-chart place used for TA (#39)' }),
    autoTrigger: z.enum(['allowances_run', 'dcr_submit']).nullable().default(null).meta({
      description:
        'What wrote an auto line (POST .../allowances or DCR submit); null on manual lines',
    }),
    dcrRejectedAt: Timestamp.nullable().default(null).meta({
      description:
        "Set when the day's DCR was rejected after this line was added (the line stays on a submitted/approved/paid claim; auto lines on draft/rejected claims are removed instead)",
    }),
    attachments: z.array(ExpenseAttachment),
    version: z.int(),
  })
  .meta({ id: 'ExpenseLine' });

export const ExpenseApprover = z
  .object({ id: Id, name: z.string(), role: z.string().nullable() })
  .meta({ id: 'ExpenseApprover', description: 'User ref with their most senior role key' });
export type ExpenseApprover = z.infer<typeof ExpenseApprover>;

export const ExpenseApprovalLevel = z
  .object({
    level: z.int().min(1),
    approver: ExpenseApprover.nullable().meta({
      description:
        'Assigned approver of this level (projected up the manager chain for levels not reached yet); null when skipped, shared queue or auto-approved',
    }),
    decidedBy: ExpenseApprover.nullable().meta({
      description:
        'Who actually decided (may be above the assigned approver); null if undecided or system',
    }),
    status: z.enum(['pending', 'approved', 'rejected', 'skipped']),
    current: z.boolean().meta({ description: 'True for the level awaiting a decision now' }),
    decidedAt: Timestamp.nullable(),
    comment: z.string().nullable(),
    rejectionReason: z.string().nullable().meta({ description: 'comment when status is rejected' }),
  })
  .meta({ id: 'ExpenseApprovalLevel' });
export type ExpenseApprovalLevel = z.infer<typeof ExpenseApprovalLevel>;

export const ExpenseClaim = z
  .object({
    id: Id,
    userId: Id,
    userName: z.string(),
    month: Month,
    status: ExpenseStatus,
    total: z.number(),
    currency: z.literal('INR'),
    lines: z.array(ExpenseLine),
    approvalId: Id.nullable().meta({ description: 'Current approval request (generic engine)' }),
    approvalStep: z.int().nullable(),
    submittedAt: Timestamp.nullable(),
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
    paidAt: Timestamp.nullable(),
    paymentRef: z.string().nullable(),
    dcrRejectedDates: z.array(DateOnly).default([]).meta({
      description:
        'Dates of live lines whose DCR was rejected (lines[].dcrRejectedAt set); approvers see the flag dcr_rejected_lines on the Approval',
    }),
    version: z.int(),
    approvalTrail: z.array(ExpenseApprovalLevel).default([]).meta({
      description:
        'Per-level history of the current approval request, level 1..totalLevels (empty while draft/never submitted)',
    }),
    totalLevels: z
      .int()
      .min(1)
      .meta({ description: 'Configured approval levels (EXPENSE_APPROVAL_LEVELS)' }),
    currentApprover: ExpenseApprover.nullable().meta({
      description:
        'Approver of the level awaiting a decision; null unless submitted (or shared queue)',
    }),
    canDecide: z.boolean().meta({
      description:
        'The caller may approve/reject now (same rules as POST /decision; DCR gate not pre-checked)',
    }),
    canPay: z.boolean().meta({ description: 'The caller may mark it paid now (POST /pay)' }),
    paidBy: UserRef.nullable().meta({ description: 'Who marked it paid; null unless paid' }),
  })
  .meta({ id: 'ExpenseClaim' });
export type ExpenseClaim = z.infer<typeof ExpenseClaim>;

export const ExpenseClaimSummary = ExpenseClaim.omit({ lines: true })
  .extend({ lineCount: z.int() })
  .meta({ id: 'ExpenseClaimSummary' });
export const ExpenseClaimList = z
  .object({
    items: z.array(ExpenseClaimSummary),
    limit: z.int().optional().meta({ description: 'Paged reads only (limit or cursor sent)' }),
    total: z.int().min(0).optional().meta({
      description: 'Paged reads only: claims matching the filters (all pages)',
    }),
    nextCursor: z.string().nullable().optional().meta({
      description: 'Paged reads only: pass as cursor for the next page; null on the last page',
    }),
  })
  .meta({ id: 'ExpenseClaimList' });
export const ExpenseClaimListQuery = z
  .object({
    month: Month.optional(),
    userId: Id.optional(),
    status: ExpenseStatus.optional(),
    limit: z.coerce.number().int().min(1).max(200).optional().meta({
      description:
        'Opt-in paging (default 50 once cursor is sent). Without limit and cursor every readable claim is returned, as before',
    }),
    cursor: z.string().max(200).optional().meta({ description: 'Opaque cursor from `nextCursor`' }),
  })
  .meta({ id: 'ExpenseClaimListQuery' });
export const ExpenseClaimCreate = z
  .object({ month: Month })
  .meta({ id: 'ExpenseClaimCreate', description: 'Creates (or returns) your claim for the month' });
export const ExpenseLineUpdate = z
  .object({ line: ExpenseLineInput, version: z.int() })
  .meta({ id: 'ExpenseLineUpdate' });
export const ExpenseDecision = z
  .object({
    decision: z.enum(['approve', 'reject']),
    comment: z.string().trim().max(1000).optional().meta({
      description:
        'Trimmed. Required to reject: missing, blank or whitespace-only gives 422 REJECTION_REASON_REQUIRED',
    }),
  })
  .meta({ id: 'ExpenseDecision' });
export const ExpensePay = z
  .object({ paymentRef: z.string().min(1).max(100) })
  .meta({ id: 'ExpensePay' });

export const ExpenseAttachmentCreate = z
  .object({
    fileName: z.string().min(1).max(200).meta({
      description: 'Used only to check the extension; never stored or put in the key',
    }),
    contentType: z.enum(EXPENSE_CONTENT_TYPES),
    sizeBytes: z.int().min(1).max(EXPENSE_MAX_FILE_BYTES),
  })
  .refine(
    (a) => (EXPENSE_FILE_TYPES[a.contentType] as readonly string[]).includes(fileExt(a.fileName)),
    { message: 'File extension does not match contentType', path: ['fileName'] },
  )
  .meta({ id: 'ExpenseAttachmentCreate' });
export const ExpenseAttachmentUpload = z
  .object({
    attachment: ExpenseAttachment,
    uploadUrl: z.url(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()).meta({ description: 'Send exactly these' }),
    expiresAt: Timestamp,
  })
  .meta({ id: 'ExpenseAttachmentUpload' });
export const ExpenseDownload = z
  .object({ downloadUrl: z.url(), expiresAt: Timestamp })
  .meta({ id: 'ExpenseDownload' });

export const RECON_FLAGS = [
  'no_dcr',
  'dcr_not_submitted',
  'dcr_link_mismatch',
  'non_field_day',
  'outside_month',
] as const;
export const ExpenseReconDay = z
  .object({
    date: DateOnly,
    claimed: z.number(),
    lineCount: z.int(),
    dcrId: Id.nullable(),
    dcrStatus: z.enum(['draft', 'submitted', 'approved', 'rejected', 'locked']).nullable(),
    flags: z.array(z.enum(RECON_FLAGS)),
  })
  .meta({ id: 'ExpenseReconDay' });
export const ExpenseReconciliation = z
  .object({
    claimId: Id,
    userId: Id,
    month: Month,
    total: z.number(),
    claimedDays: z.int(),
    dcrDays: z.int().meta({ description: 'Submitted DCR days in the month' }),
    matchedDays: z.int(),
    unmatchedAmount: z.number().meta({ description: 'Sum claimed on flagged days' }),
    byCategory: z.record(ExpenseCategory, z.number()),
    days: z.array(ExpenseReconDay),
  })
  .meta({ id: 'ExpenseReconciliation' });
export const ExpenseReportQuery = z.object({
  month: Month,
  userId: Id.optional().meta({ description: 'One user' }),
  teamOf: Id.optional().meta({ description: 'That manager and everyone below' }),
  status: ExpenseStatus.optional(),
});
export const ExpenseReportRow = ExpenseReconciliation.omit({ days: true })
  .extend({ userName: z.string(), status: ExpenseStatus })
  .meta({ id: 'ExpenseReportRow' });
export const ExpenseReport = z
  .object({
    month: Month,
    rows: z.array(ExpenseReportRow),
    total: z.number(),
    byCategory: z.record(ExpenseCategory, z.number()),
  })
  .meta({ id: 'ExpenseReport' });
export const ExpenseExportQuery = ExpenseReportQuery.extend({ format: z.enum(['xlsx', 'pdf']) });
export type ExpenseStatus = z.infer<typeof ExpenseStatus>;
export type ExpenseAttachmentCreate = z.infer<typeof ExpenseAttachmentCreate>;
export type ExpenseReconciliation = z.infer<typeof ExpenseReconciliation>;
export type ExpenseCategory = z.infer<typeof ExpenseCategory>;
