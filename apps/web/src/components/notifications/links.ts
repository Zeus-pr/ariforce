import type { components } from '@ariforce/contracts';

export type AppNotification = components['schemas']['Notification'];

/** Where a notification opens. Leave → /leave, expense → /expenses/{id}, exceptions digest → /exceptions. */
export function notificationHref(n: Pick<AppNotification, 'type' | 'entityType' | 'entityId'>): string | null {
  if (n.type === 'exceptions.digest') return '/exceptions';
  if (n.entityType === 'leave_request' || n.type.startsWith('leave.')) return '/leave';
  if (n.entityType === 'expense_claim' || n.type.startsWith('expense.'))
    return n.entityId ? `/expenses/${n.entityId}` : '/expenses';
  return null;
}
