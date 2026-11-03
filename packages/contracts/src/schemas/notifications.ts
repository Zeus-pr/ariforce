import * as z from 'zod';
import { Id, Timestamp } from './common';

/** Event types that create in-app notifications (#35, docs/NOTIFICATIONS.md). */
export const NOTIFICATION_TYPES = [
  'leave.submitted',
  'leave.approved',
  'leave.rejected',
  'leave.cancelled',
  'expense.submitted',
  'expense.approved',
  'expense.rejected',
  'expense.paid',
  'exceptions.digest',
  'expense.blocked',
  'tour_plan.submitted',
  'tour_plan.approved',
  'tour_plan.rejected',
  'doctor.approved',
  'doctor.rejected',
  'dcr.submitted',
  'dcr.approved',
  'dcr.rejected',
  'dcr_unlock.submitted',
  'dcr_unlock.approved',
  'dcr_unlock.rejected',
] as const;
export const NotificationType = z.enum(NOTIFICATION_TYPES).meta({ id: 'NotificationType' });
export type NotificationType = z.infer<typeof NotificationType>;

/** Deep-link target types (entityType + entityId open the subject). */
export const NOTIFICATION_ENTITY_TYPES = [
  'leave_request',
  'expense_claim',
  'tour_plan',
  'tour_plan_item',
  'doctor',
  'dcr',
  'approval_request',
] as const;

export const Notification = z
  .object({
    id: Id,
    type: NotificationType,
    title: z.string(),
    body: z.string(),
    entityType: z.enum(NOTIFICATION_ENTITY_TYPES).nullable().meta({
      description:
        'Deep link target type. dcr: entityId = DCR id; tour_plan_item: entityId = item id; tour_plan: plan id; approval_request (dcr_unlock.*): the request id, data.date = the day',
    }),
    entityId: Id.nullable().meta({ description: 'Deep link target id' }),
    data: z.record(z.string(), z.unknown()).nullable().meta({
      description:
        'Event data. Always: actorId (null = system), actorName. Auto-approvals: autoApproved true, reason. dcr.*: date. dcr_unlock.*: date, approvalId. tour_plan.* (item): from, to, approvalId. expense.blocked: claimId, dates, dcrIds, dcrStatus, ownerId',
    }),
    readAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'Notification' });
export type Notification = z.infer<typeof Notification>;

export const NotificationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30).optional(),
  cursor: z.string().max(100).optional().meta({ description: 'Opaque cursor from `nextCursor`' }),
  unreadOnly: z.enum(['true', 'false']).optional(),
});
export const NotificationPage = z
  .object({
    items: z.array(Notification),
    nextCursor: z.string().nullable(),
    serverTime: Timestamp,
  })
  .meta({ id: 'NotificationPage' });
export const UnreadCount = z.object({ count: z.int().min(0) }).meta({ id: 'UnreadCount' });
export const ReadAllResult = z.object({ updated: z.int().min(0) }).meta({ id: 'ReadAllResult' });
export const JobStats = z
  .object({ queued: z.int(), running: z.int(), done: z.int(), dead: z.int() })
  .meta({ id: 'JobStats' });
