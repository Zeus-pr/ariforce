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
      data: {
        typeCode: 'CL',
        fromDate: '2026-09-12',
        toDate: '2026-09-12',
        comment: 'Month-end review that week',
        actorName: 'Anita Rao',
      },
    },
  ].map((r, i) => ({
    data: null,
    ...(r as Pick<N, 'type' | 'title' | 'body' | 'entityType'> & { data?: N['data'] }),
    id: id(90 - i),
    entityId: id(500 + i),
    readAt: i >= 2 ? at(i) : null,
    createdAt: at(i + 1),
  }));
  // One of each approval-flow type with its route data (read, so the unread count stays 2).
  const actor = { actorId: id(700), actorName: 'Ravi Kumar' };
  const more: Omit<N, 'id' | 'readAt' | 'createdAt'>[] = [
    {
      type: 'dcr.submitted',
      title: 'DCR to review',
      body: 'Ravi Kumar submitted the DCR for 2026-10-19.',
      entityType: 'dcr',
      entityId: id(601),
      data: { ...actor, date: '2026-10-19' },
    },
    {
      type: 'dcr.approved',
      title: 'DCR approved',
      body: 'Your DCR for 2026-10-18 was approved by Anita Rao.',
      entityType: 'dcr',
      entityId: id(602),
      data: { actorId: id(701), actorName: 'Anita Rao', date: '2026-10-18' },
    },
    {
      type: 'dcr.rejected',
      title: 'DCR rejected',
      body: 'Your DCR for 2026-10-17 was rejected by Anita Rao. Reason: Add the chemist calls',
      entityType: 'dcr',
      entityId: id(603),
      data: {
        actorId: id(701),
        actorName: 'Anita Rao',
        date: '2026-10-17',
        reason: 'Add the chemist calls',
      },
    },
    {
      type: 'dcr_unlock.submitted',
      title: 'DCR correction to review',
      body: 'Ravi Kumar asked to correct the DCR for 2026-10-10. Reason: Forgot to submit',
      entityType: 'approval_request',
      entityId: id(604),
      data: { ...actor, date: '2026-10-10', approvalId: id(604), reason: 'Forgot to submit' },
    },
    {
      type: 'dcr_unlock.approved',
      title: 'DCR correction approved',
      body: 'Your DCR correction for 2026-10-09 was approved by Anita Rao. The day is open for editing.',
      entityType: 'approval_request',
      entityId: id(605),
      data: { actorId: id(701), actorName: 'Anita Rao', date: '2026-10-09', approvalId: id(605) },
    },
    {
      type: 'dcr_unlock.rejected',
      title: 'DCR correction rejected',
      body: 'Your DCR correction for 2026-10-08 was rejected by Anita Rao. Reason: Too late',
      entityType: 'approval_request',
      entityId: id(606),
      data: {
        actorId: id(701),
        actorName: 'Anita Rao',
        date: '2026-10-08',
        approvalId: id(606),
        reason: 'Too late',
      },
    },
    {
      type: 'tour_plan.submitted',
      title: 'Tour plan to review',
      body: 'Ravi Kumar submitted the tour plan 2026-11-02 to 2026-11-04.',
      entityType: 'tour_plan_item',
      entityId: id(607),
      data: { ...actor, from: '2026-11-02', to: '2026-11-04', approvalId: id(617) },
    },
    {
      type: 'tour_plan.approved',
      title: 'Tour plan approved',
      body: 'Your tour plan for 2026-11-05 was approved automatically (no manager).',
      entityType: 'tour_plan_item',
      entityId: id(608),
      data: {
        actorId: null,
        actorName: 'AriForce',
        from: '2026-11-05',
        to: '2026-11-05',
        approvalId: id(618),
        autoApproved: true,
        reason: 'auto-approved, no manager',
      },
    },
    {
      type: 'expense.blocked',
      title: 'DCRs waiting for you',
      body: "Ravi Kumar's 2026-10-01 expense claim can't be approved until the DCRs for 2026-10-03 are approved.",
      entityType: 'expense_claim',
      entityId: id(609),
      data: {
        ...actor,
        claimId: id(609),
        month: '2026-10-01',
        ownerId: id(700),
        ownerName: 'Ravi Kumar',
        dates: ['2026-10-03'],
        dcrIds: [id(603)],
        dcrStatus: { '2026-10-03': 'submitted' },
      },
    },
  ];
  more.forEach((r, i) =>
    rows.push({ ...r, id: id(80 - i), readAt: at(10 + i), createdAt: at(10 + i) }),
  );
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
