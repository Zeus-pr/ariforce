/**
 * LOCAL ADAPTER TYPES, not an API contract. Shaped like the endpoints the web needs from the Architect
 * (CONTRACT-GAPS #21): GET /v1/org/tree, GET /v1/org/unassigned, GET /v1/hqs, POST /v1/employees,
 * PATCH /v1/employees/{id}. When those land in packages/contracts, swap `adapter.ts` only.
 * No payroll fields (PAN, bank, CTC, salary) by design.
 */
import type { SalesRole } from '@/lib/roles';

export type Hq = { id: string; name: string; city: string; state: string };

export type Employee = {
  id: string;
  name: string;
  role: SalesRole;
  employeeCode: string;
  phone: string;
  email: string;
  hqId: string | null;
  /** null = no reporting manager yet (the Unassigned group). */
  managerId: string | null;
  active: boolean;
  /** Has no login yet (status invited): can be sent an invite link. */
  invited?: boolean;
};

/** GET /v1/org/tree: the caller plus everyone under them, flat with managerId links. */
export type OrgTree = { rootId: string; nodes: Employee[] };

export type Page<T> = { items: T[]; nextCursor: string | null; total: number };

export type EmployeeInput = Pick<
  Employee,
  'name' | 'phone' | 'email' | 'role' | 'hqId' | 'managerId'
>;
export type EmployeePatch = Partial<EmployeeInput & { active: boolean }>;

export class AdapterError extends Error {
  constructor(
    message: string,
    public field?: keyof EmployeeInput,
  ) {
    super(message);
  }
}

/** POST /v1/employees/{id}/invite. `inviteUrl` is null when the API emails it (INVITE_RETURN_LINK off). */
export type InviteResult = { id: string; name: string; expiresAt: string; inviteUrl: string | null };

/** POST /v1/employees/invite-bulk, one row per person sent (index = position in the whole list). */
export type BulkInviteRow = {
  index: number;
  name: string;
  email: string;
  status: 'invited' | 'skipped' | 'failed';
  code: string | null;
  message: string | null;
  inviteUrl: string | null;
};
export type BulkInviteResult = { rows: BulkInviteRow[]; summary: { invited: number; skipped: number; failed: number } };
/** Server cap per request; the client sends larger lists in chunks of this size. */
export const BULK_CHUNK = 200;
