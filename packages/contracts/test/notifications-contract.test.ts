import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_ENTITY_TYPES,
  NOTIFICATION_TYPES,
  Notification,
} from '../src/schemas/notifications';
import { seedNotifications } from '../src/mocks/notifications';

describe('notifications contract', () => {
  it('has the approval-flow types and entity types the app uses', () => {
    for (const t of [
      'dcr.submitted',
      'dcr.approved',
      'dcr.rejected',
      'dcr_unlock.submitted',
      'dcr_unlock.approved',
      'dcr_unlock.rejected',
      'tour_plan.submitted',
      'expense.blocked',
    ])
      expect(NOTIFICATION_TYPES).toContain(t);
    expect(NOTIFICATION_ENTITY_TYPES).toEqual(expect.arrayContaining(['dcr', 'tour_plan_item']));
  });

  it('seeds valid rows, newest first, with route data', () => {
    const rows = seedNotifications();
    for (const r of rows) Notification.parse(r);
    expect([...rows].sort((a, b) => (a.id < b.id ? 1 : -1)).map((r) => r.id)).toEqual(
      rows.map((r) => r.id),
    );
    expect(rows.filter((r) => !r.readAt)).toHaveLength(2);
    const unlock = rows.filter((r) => r.type.startsWith('dcr_unlock.'));
    expect(
      unlock.every((r) => r.entityType === 'approval_request' && typeof r.data?.date === 'string'),
    ).toBe(true);
    const tp = rows.filter((r) => r.type.startsWith('tour_plan.'));
    expect(tp.every((r) => r.entityType === 'tour_plan_item')).toBe(true);
  });
});
