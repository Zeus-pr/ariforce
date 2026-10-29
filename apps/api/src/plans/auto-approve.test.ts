import { describe, expect, it } from 'vitest';
import { submitStatus } from '../dcr/dcr.service';
import { AUTO_APPROVE_REASON, autoApproveAudit, deciderId, isDirector } from './auto-approve';

const director = { roles: ['director' as const] };
const mr = { roles: ['business_manager' as const] };

describe('director auto-approve', () => {
  it('detects directors by role', () => {
    expect(isDirector(director)).toBe(true);
    expect(isDirector(mr)).toBe(false);
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
