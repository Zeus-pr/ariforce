import * as z from 'zod';
import { DateOnly, Id, Timestamp } from './common';
import { DcrDetails, DcrSfcRouteChoice } from './dcr-parts';

/**
 * Tour plan items (TP feature): a one-day or from-to plan carrying the DCR's day fields, sent for
 * approval (reporting line, approvals:decide, never your own) and, once approved, offered on the
 * DCR screen as a prefilled draft per day. Separate from the monthly TourPlan (days[].entries[]).
 */
export const TP_ITEM_MAX_DAYS = 31;

export const TourPlanItemStatus = z
  .enum(['draft', 'pending', 'approved', 'rejected'])
  .meta({ id: 'TourPlanItemStatus' });
export type TourPlanItemStatus = z.infer<typeof TourPlanItemStatus>;

export const TourPlanItemPlan = z
  .object({
    workTypeId: Id,
    territoryIds: z.array(Id).max(20).default([]),
    workWithUserIds: z.array(Id).max(20).default([]),
    sfcRoutes: z.array(DcrSfcRouteChoice).max(20).default([]).meta({
      description: 'One route per HQ of the day (as DCR sfcRoutes); fully checked at DCR submit',
    }),
    details: DcrDetails.nullable().default(null).meta({
      description:
        "Meeting/training/office details; kind must match the work type's detailsKind. Never leave",
    }),
  })
  .meta({ id: 'TourPlanItemPlan' });
export type TourPlanItemPlan = z.infer<typeof TourPlanItemPlan>;

export const TourPlanItem = z
  .object({
    id: Id,
    companyId: Id,
    userId: Id,
    userName: z.string(),
    from: DateOnly,
    to: DateOnly.meta({ description: `from..to inclusive, at most ${TP_ITEM_MAX_DAYS} days` }),
    status: TourPlanItemStatus,
    rejectionReason: z.string().nullable().meta({ description: 'Set while rejected' }),
    plan: TourPlanItemPlan,
    filedDates: z.array(DateOnly).meta({
      description:
        "Days in from..to with a counted DCR of the owner (submitted/approved; rejected don't count)",
    }),
    version: z.int().min(1),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    submittedAt: Timestamp.nullable(),
    decidedAt: Timestamp.nullable(),
    decidedBy: Id.nullable(),
  })
  .meta({ id: 'TourPlanItem' });
export type TourPlanItem = z.infer<typeof TourPlanItem>;

/** Inclusive day count of from..to (UTC calendar arithmetic on YYYY-MM-DD). */
export const tpItemDayCount = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export const TourPlanItemUpsert = z
  .object({
    id: Id.optional().meta({ description: 'Omit to create; else your draft or rejected item' }),
    version: z
      .int()
      .min(1)
      .optional()
      .meta({ description: 'Row version from the last read (updates)' }),
    from: DateOnly,
    to: DateOnly,
    plan: TourPlanItemPlan,
  })
  .refine((b) => b.to >= b.from, { path: ['to'], message: 'to must be on or after from' })
  .refine((b) => b.to < b.from || tpItemDayCount(b.from, b.to) <= TP_ITEM_MAX_DAYS, {
    path: ['to'],
    message: `At most ${TP_ITEM_MAX_DAYS} days`,
  })
  .meta({ id: 'TourPlanItemUpsert' });
export type TourPlanItemUpsert = z.infer<typeof TourPlanItemUpsert>;

export const TourPlanItemListQuery = z
  .object({
    mine: z.enum(['true', 'false']).optional().meta({
      description:
        "true: the caller's items (newest first). Else the team's items, never your own (approvals:decide or field:read), oldest from first",
    }),
    status: TourPlanItemStatus.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().optional(),
  })
  .meta({ id: 'TourPlanItemListQuery' });

export const TourPlanItemList = z
  .object({
    items: z.array(TourPlanItem),
    nextCursor: z.string().nullable(),
    serverTime: Timestamp,
  })
  .meta({ id: 'TourPlanItemList' });

export const TourPlanItemDecision = z
  .object({
    decision: z.enum(['approve', 'reject']),
    comment: z.string().trim().max(500).optional().meta({
      description: 'Required (1-500) to reject: else 422 REJECTION_REASON_REQUIRED',
    }),
  })
  .meta({ id: 'TourPlanItemDecision' });

/** Every date from..to inclusive. */
export function tpItemDates(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  while (d.getTime() <= end && out.length < TP_ITEM_MAX_DAYS + 1) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Days of from..to with a counted (submitted/approved) report. */
export function tpItemFiledDates(
  from: string,
  to: string,
  reports: { date: string; status: string }[],
): string[] {
  const filed = new Set(
    reports.filter((r) => r.status === 'submitted' || r.status === 'approved').map((r) => r.date),
  );
  return tpItemDates(from, to).filter((d) => filed.has(d));
}

/**
 * The DCR-screen card of an item, or null when hidden. Shown only for approved items while some
 * unfiled day is today (IST) or later: once the last unfiled day locks (00:00 IST next day) or
 * every day is filed, it hides. fileableDates = today (submit allowed); future pending days take
 * drafts only (submit opens on the day); past unfiled days are locked (correction flow).
 */
export function tpItemCard(
  item: { status: string; from: string; to: string },
  reports: { date: string; status: string }[],
  today: string,
): {
  pendingDates: string[];
  draftDates: string[];
  fileableDates: string[];
  filedDates: string[];
} | null {
  if (item.status !== 'approved') return null;
  const filedDates = tpItemFiledDates(item.from, item.to, reports);
  const filed = new Set(filedDates);
  const open = tpItemDates(item.from, item.to).filter((d) => !filed.has(d) && d >= today);
  if (!open.length) return null;
  const drafts = new Set(reports.filter((r) => r.status === 'draft').map((r) => r.date));
  return {
    filedDates,
    pendingDates: open,
    draftDates: open.filter((d) => drafts.has(d)),
    fileableDates: open.filter((d) => d === today),
  };
}
