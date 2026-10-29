import { describe, expect, it } from 'vitest';
import { routeToHolders } from './approval-routing';

describe('routeToHolders (DCR unlock -> directors)', () => {
  it('one director is named on the step', () => {
    expect(routeToHolders(['d1'], 'rep')).toEqual({
      approverUserId: 'd1',
      payload: { routedTo: 'permission_holders', approverIds: ['d1'] },
    });
  });
  it('several directors share the queue (approver null, all listed)', () => {
    expect(routeToHolders(['d1', 'd2', 'd1'], 'rep')).toEqual({
      approverUserId: null,
      payload: { routedTo: 'permission_holders', approverIds: ['d1', 'd2'] },
    });
  });
  it('never routes to the requester; none left is null (NO_APPROVER)', () => {
    expect(routeToHolders(['d1', 'd2'], 'd1')?.approverUserId).toBe('d2');
    expect(routeToHolders(['d1'], 'd1')).toBeNull();
    expect(routeToHolders([], 'rep')).toBeNull();
  });
});
