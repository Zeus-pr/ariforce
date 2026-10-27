import * as z from 'zod';
import { DateOnly, Id, Timestamp } from './common';
import { ExpenseClaim } from './expenses';
import { Approval, TourPlan } from './field';
import { LeaveBalanceItem, LeaveRequest } from './leave';

/** Id + display name of a referenced master or user. */
const Ref = z.object({ id: Id, name: z.string() }).meta({ id: 'ApprovalRef' });

export const ApprovalTourPlanEntry = z
  .object({
    session: z.enum(['full', 'am', 'pm']),
    workType: Ref.nullable(),
    territories: z.array(Ref),
    jointWorkUsers: z.array(Ref),
    doctors: z.array(
      Ref.extend({ specialtyName: z.string().nullable(), categoryName: z.string().nullable() }),
    ),
    chemists: z.array(Ref),
    notes: z.string().nullable(),
  })
  .meta({ id: 'ApprovalTourPlanEntry' });

export const ApprovalSubjectTourPlan = z
  .object({
    type: z.literal('tour_plan'),
    plan: TourPlan,
    days: z.array(z.object({ date: DateOnly, entries: z.array(ApprovalTourPlanEntry) })).meta({
      description: 'plan.days with every id resolved to a name (deleted masters keep their id)',
    }),
  })
  .meta({ id: 'ApprovalSubjectTourPlan' });

export const ApprovalSubjectLeave = z
  .object({
    type: z.literal('leave'),
    request: LeaveRequest,
    balance: z
      .object({
        item: LeaveBalanceItem,
        availableBefore: z.number().nullable().meta({ description: 'Without this request' }),
        availableAfter: z.number().nullable().meta({ description: 'With this request counted' }),
      })
      .nullable()
      .meta({ description: 'Balance of this leave type for the request year; null = unknown' }),
    overlaps: z
      .array(
        z.object({
          userId: Id,
          userName: z.string(),
          typeCode: z.string(),
          fromDate: DateOnly,
          toDate: DateOnly,
          status: z.enum(['pending', 'approved']),
        }),
      )
      .meta({
        description: 'Peers (same manager) with pending/approved leave overlapping these dates',
      }),
  })
  .meta({ id: 'ApprovalSubjectLeave' });

export const ApprovalSubjectExpense = z
  .object({
    type: z.literal('expense'),
    claim: ExpenseClaim,
    allowancePlaces: z
      .array(Ref.extend({ band: z.string(), oneWayKm: z.number() }))
      .meta({ description: 'Places referenced by claim.lines[].allowancePlaceId' }),
    receipts: z
      .array(
        z.object({
          attachmentId: Id,
          lineId: Id,
          contentType: z.string(),
          downloadUrl: z.url(),
          expiresAt: Timestamp,
        }),
      )
      .meta({ description: 'Confirmed receipts only; short-lived presigned read URLs (5 min)' }),
  })
  .meta({ id: 'ApprovalSubjectExpense' });

export const ApprovalSubjectDoctor = z
  .object({
    type: z.literal('doctor'),
    doctor: z.object({
      id: Id,
      name: z.string(),
      specialtyName: z.string().nullable(),
      categoryName: z.string().nullable(),
      territory: Ref.nullable(),
      city: z.string().nullable(),
      pincode: z.string().nullable(),
      registrationNo: z.string().nullable(),
      approvalStatus: z.string(),
    }),
    possibleDuplicates: z.array(Ref).meta({ description: 'Flagged when the doctor was added' }),
  })
  .meta({ id: 'ApprovalSubjectDoctor' });

export const ApprovalSubjectDcrUnlock = z
  .object({
    type: z.literal('dcr_unlock'),
    date: DateOnly.nullable(),
    reason: z.string().nullable(),
  })
  .meta({ id: 'ApprovalSubjectDcrUnlock' });

export const ApprovalSubject = z
  .discriminatedUnion('type', [
    ApprovalSubjectTourPlan,
    ApprovalSubjectLeave,
    ApprovalSubjectExpense,
    ApprovalSubjectDoctor,
    ApprovalSubjectDcrUnlock,
  ])
  .meta({ id: 'ApprovalSubject' });
export type ApprovalSubject = z.infer<typeof ApprovalSubject>;

export const ApprovalDetail = Approval.extend({
  subject: ApprovalSubject.nullable().meta({
    description:
      'Full subject details for the requester, an assigned approver (any step) or a caller with read access to the subject; otherwise null',
  }),
}).meta({ id: 'ApprovalDetail' });
export type ApprovalDetail = z.infer<typeof ApprovalDetail>;
