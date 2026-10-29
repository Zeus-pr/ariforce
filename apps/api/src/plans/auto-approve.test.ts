import { describe, expect, it } from 'vitest';
import { submitStatus } from '../dcr/dcr.service';
import {
  AUTO_APPROVE_REASON,
  autoApproveAudit,
  deciderId,
  isDirector,
  managerRoute,
} from './auto-approve';

const director = { roles: ['director' as const] };
const mr = { roles: ['business_manager' as const] };

describe('director auto-approve', () => {
  it('detects directors by role', () => {
    expect(isDirector(director)).toBe(true);
    expect(isDirector(mr)).toBe(false);
  });

  it('routes to the manager when there is one', () => {
    expect(managerRoute(mr, 'leave', 'm1')).toEqual({ approverUserId: 'm1', error: null });
    expect(managerRoute(director, 'expense', 'm1')).toEqual({ approverUserId: 'm1', error: null });
  });

  it('lets a director without a manager through (auto-approved later)', () => {
    for (const t of ['tour_plan', 'tour_plan_item', 'expense', 'leave'])
      expect(managerRoute(director, t, null)).toEqual({ approverUserId: null, error: null });
  });

  it('rejects a non-director without a manager on manager-routed subjects only', () => {
    for (const t of ['tour_plan', 'tour_plan_item', 'expense', 'leave'])
      expect(managerRoute(mr, t, null).error).toBe('NO_MANAGER');
    expect(managerRoute(mr, 'doctor', null).error).toBeNull();
  });

  it('writes decidedBy null for the system principal', () => {
    expect(deciderId({ userId: 'u1' })).toBe('u1');
    expect(deciderId({ userId: 'u1', system: true })).toBeNull();
  });

  it('builds the audit record', () => {
    const at = new Date('2026-10-29T10:00:00Z');
    expect(
      autoApproveAudit({
        subjectType: 'leave',
        subjectId: 's',
        requestId: 'r',
        requestedBy: 'u',
        at,
      }),
    ).toEqual({
      actor: 'system',
      reason: AUTO_APPROVE_REASON,
      at: '2026-10-29T10:00:00.000Z',
      subjectType: 'leave',
      subjectId: 's',
      requestId: 'r',
      requestedBy: 'u',
      decision: 'approved',
      decidedBy: null,
    });
    expect(AUTO_APPROVE_REASON).toBe('auto-approved, no manager');
  });

  it('approves a director DCR at submit, others go to submitted', () => {
    const at = new Date('2026-10-29T10:00:00Z');
    expect(submitStatus(director, at)).toEqual({
      status: 'approved',
      approvedAt: at,
      approvedBy: null,
    });
    expect(submitStatus(mr, at)).toEqual({ status: 'submitted' });
  });
});
