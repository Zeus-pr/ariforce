import { Notification, NotificationQuery } from '../schemas/notifications';
import type * as z from 'zod';

type N = z.infer<typeof Notification>;
const at = (h: number) => new Date(Date.UTC(2026, 9, 20, 12 - h)).toISOString();
const id = (i: number) => `0192f1d2-7c3a-7b4e-9a1f-${String(100000000000 + i).padStart(12, '0')}`;

/** Mock inbox: newest first (ids descend like uuidv7). */
export function seedNotifications(): N[] {
  const rows: N[] = [
    {
      type: 'leave.submitted',
      title: 'Leave request to review',
      body: 'Ravi Kumar applied for CL leave 2026-10-28 to 2026-10-29.',
      entityType: 'leave_request',
    },
    {
      type: 'expense.approved',
      title: 'Expense claim approved',
      body: 'Your 2026-09 expense claim (INR 4250) was approved by Anita Rao.',
      entityType: 'expense_claim',
    },
    {
      type: 'leave.approved',
      title: 'Leave approved',
      body: 'Your EL leave on 2026-10-05 was approved by Anita Rao.',
      entityType: 'leave_request',
    },
    {
      type: 'expense.paid',
      title: 'Expense claim paid',
      body: 'Your 2026-08 expense claim (INR 3900) was marked paid.',
      entityType: 'expense_claim',
    },
    {
      type: 'leave.rejected',
      title: 'Leave rejected',
      body: 'Your CL leave on 2026-09-12 was rejected by Anita Rao. Comment: Month-end review that week',
      entityType: 'leave_request',
      // Same data the API stores: the request payload plus comment and actorName.
      data: { typeCode: 'CL', fromDate: '2026-09-12', toDate: '2026-09-12', comment: 'Month-end review that week', actorName: 'Anita Rao' },
    },
  ].map((r, i) => ({
    data: null,
    ...(r as Pick<N, 'type' | 'title' | 'body' | 'entityType'> & { data?: N['data'] }),
    id: id(90 - i),
    entityId: id(500 + i),
    readAt: i >= 2 ? at(i) : null,
    createdAt: at(i + 1),
  }));
  return rows;
}

export function listNotifications(
  rows: N[],
  url: URL,
): { items: N[]; nextCursor: string | null; serverTime: string } | { error: string } {
  const q = NotificationQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) return { error: q.error.issues[0]?.message ?? 'Invalid query' };
  const limit = q.data.limit ?? 30;
  const after = q.data.cursor ? atob(q.data.cursor) : undefined;
  const all = rows.filter(
    (r) => (q.data.unreadOnly !== 'true' || !r.readAt) && (!after || r.id < after),
  );
  const items = all.slice(0, limit);
  return {
    items,
    nextCursor: all.length > limit ? btoa(items.at(-1)!.id).replace(/=+$/, '') : null,
    serverTime: new Date().toISOString(),
  };
}
