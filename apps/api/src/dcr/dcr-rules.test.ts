import { describe, expect, it } from 'vitest';
import { DcrDecision } from '@ariforce/contracts';
import {
  doctorPob,
  foreignDayCheckInIds,
  lockAtOf,
  missingCheckIns,
  missingPresentation,
  pobValue,
} from './dcr-rules';
import { draftsNewestFirst, rejectedNewestFirst, reviewable, submittedOf } from './day-report';

const call = (o: Partial<Parameters<typeof doctorPob>[0][number]>) => ({
  clientId: 'c',
  outletKind: 'doctor' as const,
  pob: [],
  productsDetailed: [],
  ...o,
});

describe('dcr rules', () => {
  it('prices POB at PTS, null without PTS', () => {
    expect(pobValue(3, '12.345')).toBe('37.04');
    expect(pobValue(3, null)).toBeNull();
  });
  it('rejects POB on doctor calls only', () => {
    expect(
      doctorPob([call({ outletKind: 'chemist', pob: [1] }), call({ clientId: 'd', pob: [1] })]),
    ).toEqual({
      reason: 'POB_NOT_ALLOWED_FOR_DOCTOR',
      callIndexes: [1],
      callIds: ['d'],
    });
    expect(doctorPob([call({ outletKind: 'stockist', pob: [1] })])).toBeNull();
  });
  it('rejects a visit check-in from another day and keeps one from this day', () => {
    expect(
      foreignDayCheckInIds(
        '2026-11-11',
        [{ checkInId: 'today' }, { checkInId: 'yesterday' }, { checkInId: null }],
        [
          { id: 'today', day: '2026-11-11' },
          { id: 'yesterday', day: '2026-11-10' },
        ],
      ),
    ).toEqual(['yesterday']);
  });
  it('needs a visit check-in on every call at submit', () => {
    expect(
      missingCheckIns([
        call({ clientId: 'a' }),
        call({ clientId: 'b', checkInId: 'v1' }),
        call({ clientId: 'c', outletKind: 'chemist' }),
      ]),
    ).toEqual({ reason: 'CALL_NOT_CHECKED_IN', callIndexes: [0, 2], callIds: ['a', 'c'] });
    expect(missingCheckIns([call({ checkInId: 'v1' })])).toBeNull();
  });
  it('needs presentationOpenedAt on doctor calls with products detailed', () => {
    expect(
      missingPresentation([
        call({ productsDetailed: [1] }),
        call({
          clientId: 'ok',
          productsDetailed: [1],
          presentationOpenedAt: '2026-10-29T05:00:00Z',
        }),
        call({ clientId: 'none' }),
        call({ clientId: 'chem', outletKind: 'chemist', productsDetailed: [1] }),
      ]),
    ).toEqual({ reason: 'PRESENTATION_NOT_OPENED', callIndexes: [0], callIds: ['c'] });
  });
  it('locks at 00:00 IST the next day', () => {
    expect(lockAtOf('2026-10-29').toISOString()).toBe('2026-10-29T18:30:00.000Z');
  });
  it('rejected never counts as the day report', () => {
    const rows = [
      {
        id: 'r',
        status: 'rejected',
        updatedAt: '2026-10-29T10:00:00Z',
        rejectedAt: '2026-10-29T10:00:00Z',
        deletedAt: null,
      },
      { id: 'd', status: 'draft', updatedAt: '2026-10-29T09:00:00Z', deletedAt: null },
    ];
    expect(submittedOf(rows as never)).toBeUndefined();
    expect(draftsNewestFirst(rows as never).map((r: { id: string }) => r.id)).toEqual(['d']);
    expect(rejectedNewestFirst(rows as never).map((r: { id: string }) => r.id)).toEqual(['r']);
  });
  it('reviews only submitted DCRs of others', () => {
    expect(reviewable({ status: 'submitted', userId: 'a' }, 'b')).toEqual({ ok: true });
    expect(reviewable({ status: 'submitted', userId: 'a' }, 'a')).toMatchObject({ status: 403 });
    expect(reviewable({ status: 'approved', userId: 'a' }, 'b')).toMatchObject({
      status: 409,
      code: 'NOT_PENDING_REVIEW',
    });
  });
  it('decision body: comment required to reject', () => {
    expect(DcrDecision.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(DcrDecision.safeParse({ decision: 'reject' }).success).toBe(false);
    expect(DcrDecision.safeParse({ decision: 'reject', comment: ' ' }).success).toBe(false);
    expect(DcrDecision.safeParse({ decision: 'reject', comment: 'x'.repeat(501) }).success).toBe(
      false,
    );
    expect(DcrDecision.safeParse({ decision: 'reject', comment: 'Wrong doctor' }).success).toBe(
      true,
    );
  });
});
