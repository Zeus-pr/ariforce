import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES } from '@ariforce/contracts';
import type { Principal } from '../auth/principal';
import type { Tx } from '@ariforce/db';
import { NotificationsService } from './notifications.service';
import { render } from './templates';

describe('notification templates', () => {
  it('renders every type', () => {
    for (const t of NOTIFICATION_TYPES) {
      const r = render(t, { actorName: 'Asha', date: '2026-10-28', from: '2026-11-02' });
      expect(r.title.length, t).toBeGreaterThan(0);
      expect(r.body.length, t).toBeGreaterThan(0);
      expect(r.body, t).not.toContain('undefined');
    }
  });

  it('says automatically for director auto-approvals', () => {
    expect(
      render('dcr.approved', { actorName: 'AriForce', autoApproved: true, date: '2026-10-28' })
        .body,
    ).toBe('Your DCR for 2026-10-28 was approved automatically (no manager).');
    expect(render('dcr.approved', { actorName: 'Ravi', date: '2026-10-28' }).body).toBe(
      'Your DCR for 2026-10-28 was approved by Ravi.',
    );
  });

  it('names the tour plan item range and the blocked DCR dates', () => {
    expect(
      render('tour_plan.submitted', { actorName: 'Asha', from: '2026-11-02', to: '2026-11-04' })
        .body,
    ).toBe('Asha submitted the tour plan 2026-11-02 to 2026-11-04.');
    expect(
      render('expense.blocked', {
        ownerName: 'Asha',
        month: '2026-10-01',
        dates: ['2026-10-03', '2026-10-04'],
      }).body,
    ).toBe(
      "Asha's 2026-10-01 expense claim can't be approved until the DCRs for 2026-10-03, 2026-10-04 are approved.",
    );
  });
});

describe('notify()', () => {
  const enqueued: { payload: Record<string, unknown>; key?: string }[] = [];
  let batches = 0;
  const jobs = {
    enqueue: (
      _tx: unknown,
      _c: string,
      _t: string,
      payload: Record<string, unknown>,
      o?: { dedupeKey?: string },
    ) => {
      enqueued.push({ payload, key: o?.dedupeKey });
      return Promise.resolve();
    },
    enqueueMany: (
      _tx: unknown,
      _c: string,
      _t: string,
      items: { payload: Record<string, unknown>; dedupeKey?: string }[],
    ) => {
      batches++;
      for (const it of items) enqueued.push({ payload: it.payload, key: it.dedupeKey });
      return Promise.resolve();
    },
  };
  const tx = { transaction: (fn: (sp: unknown) => Promise<unknown>) => fn({}) } as unknown as Tx;
  const svc = new NotificationsService(
    {} as never,
    jobs as never,
    { register: () => undefined } as never,
  );
  const p = { userId: 'u1', companyId: 'c1', roles: ['director'] } as unknown as Principal;
  const ev = {
    type: 'dcr.approved' as const,
    entityType: 'dcr' as const,
    entityId: 'd1',
    dedupeKey: 'k',
  };

  it('skips self and null recipients for a user', async () => {
    enqueued.length = 0;
    await svc.notify(tx, p, { ...ev, recipientId: 'u1' });
    await svc.notify(tx, p, { ...ev, recipientId: null });
    expect(enqueued).toHaveLength(0);
  });

  it('lets the system principal notify the director, actorId null, autoApproved', async () => {
    enqueued.length = 0;
    await svc.notify(tx, { ...p, system: true }, { ...ev, recipientId: 'u1' });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.key).toBe('u1:k');
    expect(enqueued[0]!.payload).toMatchObject({
      actorId: null,
      data: { autoApproved: true, reason: 'auto-approved, no manager' },
    });
  });

  it('fans out once per recipient', async () => {
    enqueued.length = 0;
    batches = 0;
    await svc.notifyMany(tx, p, ev, ['a', 'b', 'a', null, 'u1']);
    expect(enqueued.map((e) => e.key)).toEqual(['a:k', 'b:k']);
    expect(batches).toBe(1); // one multi-row insert per event
    expect(enqueued[0]!.payload).toMatchObject({ recipientId: 'a', actorId: 'u1' });
  });

  it('never throws when the enqueue fails', async () => {
    const bad = new NotificationsService(
      {} as never,
      { enqueue: () => Promise.reject(new Error('boom')) } as never,
      { register: () => undefined } as never,
    );
    await expect(bad.notify(tx, p, { ...ev, recipientId: 'x' })).resolves.toBeUndefined();
  });
});
