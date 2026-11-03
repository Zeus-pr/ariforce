import type { Dcr } from '@ariforce/contracts';
import type { Review } from './adapter';
import { shortLabel, type CalendarPillStatus, type DayPill } from '../calendar-pills';
import type { TpDraftCard } from '../tp/adapter';

export type { DayPill };

/** Map a DCR review into a calendar / section bucket. */
export function dcrBucket(
  review: Review,
): 'draft' | 'pending' | 'approved' | 'rejected' | null {
  switch (review.status) {
    case 'draft':
      return 'draft';
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'submitted':
    case 'locked':
      return 'pending';
    default:
      return null;
  }
}

function pillStatus(bucket: ReturnType<typeof dcrBucket>): CalendarPillStatus | null {
  if (!bucket) return null;
  return bucket;
}

/**
 * Labels for a day cell: real doctor / chemist / stockist names when resolved,
 * else workplace (territory), else work type. Never the generic "Doctor"/"Chemist".
 */
export function dcrOutletLabels(
  d: Dcr,
  names: {
    territory: Map<string, string>;
    workType: Map<string, string>;
    outlet?: Map<string, string>;
  },
): string[] {
  const outlets =
    d.calls
      ?.map((c) => names.outlet?.get(c.outletId)?.trim())
      .filter((n): n is string => !!n) ?? [];
  if (outlets.length) return outlets;

  const terr = d.territoryIds
    .map((id) => names.territory.get(id))
    .filter((n): n is string => !!n);
  if (terr.length) return terr;

  const wt = names.workType.get(d.workTypeId);
  if (wt) return [wt];
  const n = d.callCount ?? d.calls?.length ?? 0;
  return n ? [`${n} call${n === 1 ? '' : 's'}`] : ['DCR'];
}

/** Single-line fallback for list rows. */
export function dcrPillLabel(
  d: Dcr,
  names: {
    territory: Map<string, string>;
    workType: Map<string, string>;
    outlet?: Map<string, string>;
  },
): string {
  return shortLabel(dcrOutletLabels(d, names).slice(0, 2).join(', '), 18);
}

export function dcrListLabel(
  d: Dcr,
  names: {
    territory: Map<string, string>;
    workType: Map<string, string>;
  },
): string {
  const wt = names.workType.get(d.workTypeId);
  const terr = d.territoryIds
    .map((id) => names.territory.get(id))
    .filter((n): n is string => !!n);
  const n = d.callCount ?? d.calls?.length ?? 0;
  const calls = n ? `${n} call${n === 1 ? '' : 's'}` : null;
  return [wt, terr.slice(0, 2).join(' · ') || null, calls].filter(Boolean).join(' · ');
}

/**
 * One pill per outlet (up to 3 stacked) + `+N` overflow, else one summary pill.
 * TP-to-file days get a `tp` pill when the day is otherwise empty.
 */
export function dcrPillsByDate(
  rows: { d: Dcr; review: Review }[],
  tpCards: TpDraftCard[],
  labelOf: (d: Dcr) => string,
  tpLabelOf: (t: TpDraftCard) => string,
  names?: {
    territory: Map<string, string>;
    workType: Map<string, string>;
    outlet?: Map<string, string>;
  },
): Map<string, DayPill[]> {
  const map = new Map<string, DayPill[]>();

  for (const { d, review } of rows) {
    const bucket = dcrBucket(review);
    const status = pillStatus(bucket);
    if (!status) continue;
    const list = map.get(d.date) ?? [];
    const outlets = names ? dcrOutletLabels(d, names) : [labelOf(d)];
    // One pill per name (stacked in the cell); calendar shows first 3 then +N.
    if (outlets.length > 1 || (d.calls?.length ?? 0) > 1) {
      outlets.forEach((name, i) => {
        list.push({
          date: d.date,
          label: shortLabel(name, 12),
          status,
          // Index keeps keys unique when two calls share a placeholder name ("Doctor").
          itemId: `${d.id}:${i}`,
        });
      });
    } else {
      list.push({
        date: d.date,
        label: shortLabel(outlets[0] ?? labelOf(d), 14),
        status,
        itemId: d.id,
      });
    }
    map.set(d.date, list);
  }

  for (const t of tpCards) {
    for (const date of t.pendingDates) {
      const existing = map.get(date) ?? [];
      if (existing.some((p) => p.status !== 'tp')) continue;
      existing.push({
        date,
        label: tpLabelOf(t),
        status: 'tp',
        itemId: `tp:${t.id}`,
      });
      map.set(date, existing);
    }
  }

  return map;
}

export function groupDcrs(rows: { d: Dcr; review: Review }[]) {
  const approved: typeof rows = [];
  const pending: typeof rows = [];
  const rejected: typeof rows = [];
  const drafts: typeof rows = [];
  for (const row of rows) {
    const b = dcrBucket(row.review);
    if (b === 'approved') approved.push(row);
    else if (b === 'pending') pending.push(row);
    else if (b === 'rejected') rejected.push(row);
    else if (b === 'draft') drafts.push(row);
  }
  return { approved, pending, rejected, drafts };
}
