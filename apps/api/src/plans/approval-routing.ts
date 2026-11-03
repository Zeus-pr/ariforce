/**
 * Step-1 routing for requests sent to permission holders (dcr_unlock -> the company's directors).
 * One holder: named on the step. Several: approver null (shared queue; any one decides, all see it),
 * all listed in payload.approverIds. None: null (the caller throws 422 NO_APPROVER).
 */
export function routeToHolders(holderIds: string[], requesterId: string) {
  const ids = [...new Set(holderIds)].filter((x) => x !== requesterId);
  if (!ids.length) return null;
  return {
    approverUserId: ids.length === 1 ? ids[0]! : null,
    payload: { routedTo: 'permission_holders' as const, approverIds: ids },
  };
}
