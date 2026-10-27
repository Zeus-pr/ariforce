/**
 * Plain-words messages for the two "who can hold what" rules the API enforces when a person gets a
 * role or territories (POST /v1/employees, POST /v1/employees/invite-bulk rows,
 * PATCH /v1/employees/{id}, POST /v1/signup-requests/{id}/approve):
 * - 422 ROLE_RETIRED: Distribution Head and Accountant can no longer be given to anyone.
 * - 422 TERRITORY_LEVEL_INVALID: a Business Manager may only hold HQs (details.territoryIds,
 *   expectedLevel, role).
 * BM territory pickers ask the API for HQs only with `assignableForRole=business_manager`.
 */
export const ROLE_RETIRED_MESSAGE = 'That role is no longer used. Pick another role.';
export const TERRITORY_LEVEL_MESSAGE =
  'A Business Manager can only be given an HQ, not an area or region. Pick an HQ.';

type Err = { code?: string; message?: string; details?: unknown } | null | undefined;

/** Friendly text for ROLE_RETIRED / TERRITORY_LEVEL_INVALID, else null. */
export function assignMessage(e: Err): string | null {
  if (e?.code === 'ROLE_RETIRED') return ROLE_RETIRED_MESSAGE;
  if (e?.code === 'TERRITORY_LEVEL_INVALID') return TERRITORY_LEVEL_MESSAGE;
  return null;
}

/** The form field each rule points at. */
export function assignField(code: string | undefined): 'role' | 'territory' | null {
  return code === 'ROLE_RETIRED' ? 'role' : code === 'TERRITORY_LEVEL_INVALID' ? 'territory' : null;
}

/** Query for a territory picker that will assign `role`: BM gets HQs only from the server. */
export const territoryQueryFor = (role: string | null | undefined) =>
  role === 'business_manager' ? { assignableForRole: 'business_manager' as const } : {};
