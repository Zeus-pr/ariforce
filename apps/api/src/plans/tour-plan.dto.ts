import type { TourPlan } from '@ariforce/contracts';
import type { tourPlans } from '@ariforce/db';
import { rejectionFields } from '../common/rejection';

type Row = typeof tourPlans.$inferSelect;
type Day = TourPlan['days'][number];

export function toPlan(r: Row): TourPlan {
  return {
    id: r.id,
    companyId: r.companyId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
    version: r.version,
    userId: r.userId,
    month: r.month.slice(0, 7),
    kind: 'mtp',
    status: r.status,
    days: (r.days as Day[]) ?? [],
    submittedAt: r.submittedAt?.toISOString() ?? null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decidedBy: r.decidedBy,
    decisionComment: r.decisionComment,
    submitterNote: r.submitterNote,
    // A rejected plan being edited (draft again) still shows why it was rejected.
    ...rejectionFields(
      r.status === 'draft' && r.decisionComment && r.decidedAt ? 'rejected' : r.status,
      r.decisionComment,
      r.decidedBy,
      r.decidedAt?.toISOString() ?? null,
    ),
  };
}
