/// <reference types="jest" />
import { notificationHref } from '@/lib/notifications';

describe('notificationHref', () => {
  it('opens one doctor from a date reminder', () => {
    expect(
      notificationHref({
        type: 'doctor.occasion',
        entityType: 'doctor',
        entityId: 'doc-1',
      }),
    ).toEqual({ pathname: '/masters/[kind]/[id]', params: { kind: 'doctors', id: 'doc-1' } });
  });

  it('leaves a company message on the notification list', () => {
    expect(
      notificationHref({
        type: 'company.message',
        entityType: null,
        entityId: null,
      }),
    ).toBeNull();
  });

  it('opens that day of the DCR when a correction carries the date', () => {
    expect(
      notificationHref({
        type: 'dcr_unlock.approved',
        entityType: 'approval_request',
        entityId: 'req-1',
        data: { date: '2026-11-06' },
      }),
    ).toEqual({ pathname: '/dcr/form', params: { date: '2026-11-06' } });
  });
});
