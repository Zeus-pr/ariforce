import * as z from 'zod';
import { Id, Timestamp } from './common';
import { SfcCategory, SfcTravelMode } from './sfc';

/** DCR redesign building blocks (docs/DCR-REDESIGN-DESIGN.md). No import of field.ts (it uses these). */

/** Field-day band; fixed by the work type (work_types.allowance_band). */
export const DcrBand = z.enum(['hq', 'ex_hq', 'outstation']).meta({ id: 'DcrBand' });
export type DcrBand = z.infer<typeof DcrBand>;

const HHmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm')
  .meta({ description: 'Local time HH:mm (IST)', example: '10:30' });
const Duration = z.int().min(1).max(720).meta({ description: 'Minutes, 1-720' });
const Remarks = z.string().trim().max(1000).nullable().optional();

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
  durationMin: Duration,
  attendees: z.string().trim().max(500).nullable().optional().meta({ description: 'Free text' }),
  remarks: Remarks,
};
const locationRule = {
  check: (d: { mode: string; location?: string | null }) =>
    d.mode !== 'in_person' || !!d.location?.trim(),
  opts: { message: 'location is required for an in-person session', path: ['location'] },
};
export const DcrMeetingDetails = z
  .object({ kind: z.literal('meeting'), ...meetingShape })
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
    durationMin: Duration,
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
