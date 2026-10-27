import { users, type Tx } from '@ariforce/db';
import { inArray } from 'drizzle-orm';
import { err } from '../field/checkins.service';

/** Rejection reasons: trimmed, non-blank, at most 1000 chars (the body schemas cap the length too). */
export const REJECTION_REASON_MAX = 1000;

/** Trimmed comment (null when blank); 422 REJECTION_REASON_REQUIRED when rejecting without one. */
export function rejectionReason(decision: 'approve' | 'reject', comment?: string | null) {
  const c = comment?.trim() ? comment.trim().slice(0, REJECTION_REASON_MAX) : null;
  if (decision === 'reject' && !c)
    throw err(422, 'REJECTION_REASON_REQUIRED', 'A reason is required to reject');
  return c;
}

/** rejectionReason/rejectedBy/rejectedAt for a subject record: set only while it is rejected. */
export function rejectionFields(
  status: string,
  comment: string | null,
  decidedBy: string | null,
  decidedAt: string | null,
) {
  const rej = status === 'rejected';
  return {
    rejectionReason: rej ? comment : null,
    rejectedBy: rej && decidedBy ? { id: decidedBy, name: '' } : null,
    rejectedAt: rej ? decidedAt : null,
  };
}

/** Fills `rejectedBy.name` (rejectionFields leaves it blank) with one users lookup. */
export async function nameRejecters<T extends { rejectedBy?: { id: string; name: string } | null }>(
  tx: Tx,
  items: T[],
): Promise<T[]> {
  const ids = [...new Set(items.flatMap((i) => (i.rejectedBy ? [i.rejectedBy.id] : [])))];
  if (!ids.length) return items;
  const rows = await tx
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids));
  const m = new Map(rows.map((r) => [r.id, r.name]));
  for (const i of items) if (i.rejectedBy) i.rejectedBy.name = m.get(i.rejectedBy.id) ?? '';
  return items;
}
