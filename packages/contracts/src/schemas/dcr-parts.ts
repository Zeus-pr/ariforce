import * as z from 'zod';
import { Id, Timestamp } from './common';
import { SfcCategory, SfcTravelMode } from './sfc';
import { ExpenseCategory } from './expenses';

/** DCR redesign building blocks (docs/DCR-REDESIGN-DESIGN.md). No import of field.ts (it uses these). */

/** Field-day band; fixed by the work type (work_types.allowance_band). */
export const DcrBand = z.enum(['hq', 'ex_hq', 'outstation']).meta({ id: 'DcrBand' });
/** Where an SFC candidate came from: the filer's own route, or the HQ fallback (no own route on that HQ). */
export const DcrSfcSource = z.enum(['own', 'hq']).meta({
  id: 'DcrSfcSource',
  description:
    "own = the filer's route; hq = the filer has no live route on that HQ, so the HQ's routes (any owner) are offered",
});
export type DcrSfcSource = z.infer<typeof DcrSfcSource>;
export type DcrBand = z.infer<typeof DcrBand>;

const HHmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm')
  .meta({ description: 'Local time HH:mm (IST)', example: '10:30' });
const Duration = z.int().min(1).max(720).meta({ description: 'Minutes, 1-720' });
const Remarks = z.string().trim().max(1000).nullable().optional();

/** Meeting sub-types (DCR and TP): the meeting details.title must be one of these on write. */
export const MEETING_TYPES = ['Cycle Meeting', 'Review Meeting'] as const;
export type MeetingTypeLabel = (typeof MEETING_TYPES)[number];
export const isMeetingType = (v: string): v is MeetingTypeLabel =>
  (MEETING_TYPES as readonly string[]).includes(v);
/** Longest derived session (minutes); longer -> 422 DURATION_TOO_LONG. Same as durationMin max. */
export const DCR_MAX_DURATION_MIN = 720;

/** HH:mm -> minutes after 00:00. */
export const hhmmToMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Server rule: durationMinutes = endTime - startTime (same day); null when not computable or <= 0. */
export const deriveDurationMinutes = (start?: string | null, end?: string | null) => {
  if (!start || !end) return null;
  const m = hhmmToMinutes(end) - hhmmToMinutes(start);
  return m > 0 ? m : null;
};

const EndTime = HHmm.nullable().optional().meta({
  description:
    'Local end time HH:mm (IST), same day, must be after startTime (else 422 END_TIME_NOT_AFTER_START). The server derives durationMin from startTime/endTime',
});
const DurationDerived = Duration.optional().meta({
  description:
    'Minutes. Derived by the server from startTime/endTime and always present in responses. Deprecated on input: ignored when endTime is sent; accepted only from older clients that send no endTime',
});
const Place = z
  .string()
  .trim()
  .max(120)
  .nullable()
  .optional()
  .meta({ description: 'Free text place, optional' });
const placesShape = { fromPlace: Place, toPlace: Place };

const meetingShape = {
  title: z.string().trim().min(1).max(120).meta({ description: 'Meeting / training type or name' }),
  mode: z.enum(['in_person', 'online']),
  location: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .meta({ description: 'Free text; required when mode = in_person (link or text when online)' }),
  startTime: HHmm,
  endTime: EndTime,
  durationMin: DurationDerived,
  attendees: z.string().trim().max(500).nullable().optional().meta({ description: 'Free text' }),
  remarks: Remarks,
};
const locationRule = {
  check: (d: { mode: string; location?: string | null }) =>
    d.mode !== 'in_person' || !!d.location?.trim(),
  opts: { message: 'location is required for an in-person session', path: ['location'] },
};
export const DcrMeetingDetails = z
  .object({
    kind: z.literal('meeting'),
    ...meetingShape,
    title: meetingShape.title.meta({
      description:
        'Meeting sub-type: "Cycle Meeting" or "Review Meeting" on write (else 422 MEETING_TYPE_INVALID). Legacy rows may hold other free text; reads return it unchanged',
    }),
    ...placesShape,
  })
  .refine(locationRule.check, locationRule.opts)
  .meta({ id: 'DcrMeetingDetails' });
export const DcrTrainingDetails = z
  .object({
    kind: z.literal('training'),
    ...meetingShape,
    trainer: z.string().trim().max(120).nullable().optional().meta({ description: 'Free text' }),
  })
  .refine(locationRule.check, locationRule.opts)
  .meta({ id: 'DcrTrainingDetails' });
export const DcrOfficeDetails = z
  .object({
    kind: z.literal('office'),
    taskType: z.string().trim().min(1).max(60),
    description: z.string().trim().min(1).max(1000),
    startTime: HHmm.nullable().optional(),
    endTime: EndTime.meta({
      description:
        'Local end time HH:mm (IST). startTime is required together with endTime (else 422 END_TIME_NOT_AFTER_START); end after start, at most 12 h (DURATION_TOO_LONG). Derives durationMin',
    }),
    durationMin: Duration.optional().meta({
      description:
        'Minutes. Derived from startTime/endTime when both are sent (input ignored); otherwise still required as before. Always present in responses',
    }),
    ...placesShape,
    remarks: Remarks,
  })
  .meta({ id: 'DcrOfficeDetails', description: 'Admin / office work' });
export const DcrLeaveDetails = z
  .object({
    kind: z.literal('leave'),
    leaveRequestId: Id.meta({
      description: 'Your leave request covering the date (pending or approved)',
    }),
  })
  .meta({ id: 'DcrLeaveDetails' });
export const DcrDetails = z
  .discriminatedUnion('kind', [
    DcrMeetingDetails,
    DcrTrainingDetails,
    DcrOfficeDetails,
    DcrLeaveDetails,
  ])
  .meta({
    id: 'DcrDetails',
    description:
      'Non-field day details; kind must match the work type (DcrWorkTypeOption.detailsKind)',
  });
export type DcrDetails = z.infer<typeof DcrDetails>;
export type DcrDetailsKind = DcrDetails['kind'];

/**
 * Details kind for a work type: leave -> leave; holiday and field -> none; non_field by code:
 * *MEET* -> meeting, *TRAIN* -> training, anything else -> office (admin work).
 */
export function dcrDetailsKind(wt: { kind: string; code: string }): DcrDetailsKind | null {
  if (wt.kind === 'leave') return 'leave';
  if (wt.kind !== 'non_field') return null;
  const c = wt.code.toUpperCase();
  if (c.includes('MEET')) return 'meeting';
  if (c.includes('TRAIN')) return 'training';
  return 'office';
}

/** TA/DA values of one SFC route, frozen on the DCR at submit. */
export const DcrSfcSnapshot = z
  .object({
    sfcRouteId: Id,
    routeVersion: z.int(),
    hqTerritoryId: Id,
    fromPlace: z.string(),
    toPlace: z.string(),
    oneWayKm: z.number(),
    bothWayKm: z.number(),
    oneWayAmount: z.number().nullable().meta({ description: 'null = actual fare' }),
    bothWayAmount: z.number().nullable().meta({ description: 'null = actual fare' }),
    actualFare: z.boolean(),
    travelMode: SfcTravelMode.nullable(),
    category: SfcCategory,
    band: DcrBand,
    da: z.number().nullable(),
    ratePerKm: z.number().meta({ description: 'Company TA rate per km at submit' }),
    frozenAt: Timestamp,
    source: DcrSfcSource.optional().meta({
      description: 'own | hq (fallback). Absent on snapshots frozen before the fallback existed',
    }),
  })
  .meta({ id: 'DcrSfcSnapshot' });
export type DcrSfcSnapshot = z.infer<typeof DcrSfcSnapshot>;

/** Chosen route for one HQ of the day. */
export const DcrSfcRouteChoice = z
  .object({ hqTerritoryId: Id, sfcRouteId: Id })
  .meta({ id: 'DcrSfcRouteChoice' });
export const DcrSfcRoute = DcrSfcRouteChoice.extend({
  snapshot: DcrSfcSnapshot.nullable().meta({ description: 'Set at submit; null on drafts' }),
}).meta({ id: 'DcrSfcRoute' });
export type DcrSfcRoute = z.infer<typeof DcrSfcRoute>;

/** Expenses reported on a DCR (any work type); linked into the month claim at submit. */
export const DCR_EXPENSE_MAX_ITEMS = 20;
/** Categories a DCR expense may use: the expense categories minus the TA/DA-engine ones. */
export const DCR_EXPENSE_CATEGORIES = [
  'travel',
  'hotel',
  'food',
  'courier',
  'mobile',
  'team_meeting',
  'other',
] as const;
export const DcrExpenseItem = z
  .object({
    category: ExpenseCategory.meta({
      description:
        'One of travel, hotel, food, other. allowance and mileage stay with TA/DA: 422 DCR_EXPENSE_CATEGORY_INVALID',
    }),
    amount: z.number().positive().max(10_000_000).multipleOf(0.01).meta({ description: 'Rupees' }),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .meta({ id: 'DcrExpenseItem' });
export type DcrExpenseItem = z.infer<typeof DcrExpenseItem>;
export const DcrExpenses = z.array(DcrExpenseItem).max(DCR_EXPENSE_MAX_ITEMS);

/** Result of linking a submitted DCR's expenses into the month claim. */
export const DcrExpenseLink = z
  .object({
    status: z.enum(['linked', 'skipped', 'error']).meta({
      description:
        "linked = the DCR's lines were written (all earlier origin-dcr lines with this dcrId are replaced, so a resubmit never duplicates); skipped = nothing written (reason); error = linking failed, the submit still succeeded",
    }),
    reason: z.enum(['claim_locked', 'no_expenses']).nullable().meta({
      description:
        'claim_locked = the month claim is submitted/approved/paid (or deleted): items stay on the DCR, not copied; no_expenses = the DCR has none (earlier DCR lines on an editable claim are removed)',
    }),
    claimId: Id.nullable(),
    claimStatus: z.enum(['draft', 'submitted', 'approved', 'rejected', 'paid']).nullable(),
    claimCreated: z.boolean(),
    lines: z.int().min(0).meta({ description: 'DCR-sourced lines now on the claim for this DCR' }),
    total: z.number().meta({ description: 'Sum of those lines, rupees' }),
  })
  .meta({ id: 'DcrExpenseLink' });
export type DcrExpenseLink = z.infer<typeof DcrExpenseLink>;
