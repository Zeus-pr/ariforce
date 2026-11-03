import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { Principal } from '../auth/principal';
import { ApprovalsService } from '../plans/approvals.service';
import { buildTrail, primaryRole, type TrailStep, type TrailUser } from './approval-trail';

const users = new Map<string, TrailUser>([
  ['bm', { name: 'Bina BM', role: 'business_manager', managerId: 'abm' }],
  ['abm', { name: 'Arun ABM', role: 'area_business_manager', managerId: 'rbm' }],
  ['rbm', { name: 'Ravi RBM', role: 'regional_business_manager', managerId: 'dir' }],
  ['dir', { name: 'Dia Director', role: 'director', managerId: null }],
  ['solo', { name: 'Solo', role: 'regional_business_manager', managerId: null }],
]);
const at = new Date('2026-11-03T06:00:00Z');
const step = (
  n: number,
  approver: string | null,
  decision = 'pending',
  by: string | null = null,
  comment: string | null = null,
): TrailStep => ({
  stepNo: n,
  approverUserId: approver,
  decision,
  decidedBy: by,
  decidedAt: by || decision !== 'pending' ? at : null,
  comment,
});
const req = (state: string, currentStep: number, requestedBy = 'bm') => ({
  state,
  currentStep,
  requestedBy,
});

describe('buildTrail', () => {
  it('draft (no request): empty trail', () => {
    expect(buildTrail(2, null, [], users)).toEqual({ approvalTrail: [], currentApprover: null });
  });

  it('two-level, level 1 pending: level 2 projected to the manager, not current', () => {
    const t = buildTrail(2, req('pending', 1), [step(1, 'abm')], users);
    expect(t.approvalTrail.map((l) => [l.level, l.status, l.current, l.approver?.id])).toEqual([
      [1, 'pending', true, 'abm'],
      [2, 'pending', false, 'rbm'],
    ]);
    expect(t.currentApprover).toEqual({
      id: 'abm',
      name: 'Arun ABM',
      role: 'area_business_manager',
    });
  });

  it('level 1 approved stays visible while level 2 is pending', () => {
    const t = buildTrail(
      2,
      req('pending', 2),
      [step(1, 'abm', 'approved', 'abm', 'ok'), step(2, 'rbm')],
      users,
    );
    expect(t.approvalTrail[0]).toMatchObject({
      level: 1,
      status: 'approved',
      decidedBy: { id: 'abm', name: 'Arun ABM' },
      comment: 'ok',
      decidedAt: at.toISOString(),
      current: false,
    });
    expect(t.approvalTrail[1]).toMatchObject({
      level: 2,
      status: 'pending',
      current: true,
      approver: { id: 'rbm', role: 'regional_business_manager' },
    });
    expect(t.currentApprover?.name).toBe('Ravi RBM');
  });

  it('rejected at level 1: rejectionReason set, level 2 skipped, no current approver', () => {
    const t = buildTrail(
      2,
      req('rejected', 1),
      [step(1, 'abm', 'rejected', 'abm', 'no bills')],
      users,
    );
    expect(t.approvalTrail.map((l) => [l.status, l.rejectionReason])).toEqual([
      ['rejected', 'no bills'],
      ['skipped', null],
    ]);
    expect(t.currentApprover).toBeNull();
  });

  it('skipped level: approved early (no next manager), level 2 skipped', () => {
    const t = buildTrail(
      2,
      req('approved', 1, 'abm'),
      [step(1, 'solo', 'approved', 'solo')],
      users,
    );
    expect(t.approvalTrail[1]).toMatchObject({ level: 2, status: 'skipped', approver: null });
  });

  it('pending with nobody above the current approver: future level skipped', () => {
    const t = buildTrail(2, req('pending', 1, 'abm'), [step(1, 'solo')], users);
    expect(t.approvalTrail[1]).toMatchObject({ status: 'skipped', approver: null });
  });

  it('decider above the assigned approver is reported in decidedBy', () => {
    const t = buildTrail(1, req('approved', 1), [step(1, 'abm', 'approved', 'dir')], users);
    expect(t.approvalTrail[0]).toMatchObject({
      approver: { id: 'abm' },
      decidedBy: { id: 'dir', role: 'director' },
    });
  });

  it('primaryRole picks the most senior role', () => {
    expect(primaryRole(['system_admin', 'director'])).toBe('director');
    expect(primaryRole([])).toBeNull();
  });
});

describe('ApprovalsService.canDecide (same rules as decide)', () => {
  const svc = new ApprovalsService({} as never, {} as never, {} as never, {} as never, {} as never);
  svc.register('expense', async () => undefined, { levels: 2, permission: 'expenses:approve' });
  const P = (
    userId: string,
    team: string[] | null,
    perms = ['approvals:decide', 'expenses:approve'],
  ) => ({ userId, teamUserIds: team, permissions: perms, roles: [] }) as unknown as Principal;
  const r = {
    state: 'pending' as const,
    requestedBy: 'bm',
    entityType: 'expense' as const,
    currentStep: 2,
  };
  const steps = [
    { stepNo: 1, approverUserId: 'abm', decidedBy: 'abm' },
    { stepNo: 2, approverUserId: 'rbm', decidedBy: null },
  ];
  it('current approver and those above may decide', () => {
    expect(svc.canDecide(P('rbm', ['rbm', 'abm', 'bm']), r, steps)).toBe(true);
    expect(svc.canDecide(P('dir', null), r, steps)).toBe(true);
  });
  it('level-1 decider, requester, below the approver or missing permission may not', () => {
    expect(svc.canDecide(P('abm', ['abm', 'bm']), r, steps)).toBe(false);
    expect(svc.canDecide(P('bm', ['bm']), r, steps)).toBe(false);
    expect(svc.canDecide(P('dir', null, ['approvals:decide']), r, steps)).toBe(false);
    expect(svc.canDecide(P('dir', null), { ...r, state: 'approved' as never }, steps)).toBe(false);
  });
});
