/**
 * LOCAL TEAM ADAPTER (mock). The only file to swap when the org/employee endpoints exist
 * (CONTRACT-GAPS #21). In-memory: resets on reload, like the MSW mock. Enforces the owner's rules:
 * new roles strictly below the caller, HQs and managers only from the caller's subtree.
 */
import { roleLevel, type Role, type SalesRole } from '@/lib/roles';
import { REAL } from '@/lib/api';
import { apiTeamAdapter, summarize } from './api-adapter';
import { HQS, ME_BY_ROLE, seedOrg } from './mock-org';
import { issueMockInvite } from '@/lib/invites/mock-store';
import {
  AdapterError,
  type Employee,
  type EmployeeInput,
  type EmployeePatch,
  type Hq,
  type BulkInviteResult,
  type BulkInviteRow,
  type InviteResult,
  type OrgTree,
  type Page,
} from './types';

let db: Employee[] | null = null;
const rows = () => (db ??= seedOrg());
const delay = () => new Promise((r) => setTimeout(r, 120));

/** Ids under `rootId` (inclusive). */
export function subtreeIds(all: Employee[], rootId: string) {
  const out = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of all)
      if (e.managerId && out.has(e.managerId) && !out.has(e.id)) {
        out.add(e.id);
        grew = true;
      }
  }
  return out;
}

function me(role: Role) {
  const id = ME_BY_ROLE[role as SalesRole];
  const self = rows().find((e) => e.id === id);
  if (!self) throw new AdapterError('My Team is for Area Business Managers and above.');
  return self;
}

function check(role: Role, input: EmployeePatch, target?: Employee) {
  const self = me(role);
  const sub = subtreeIds(rows(), self.id);
  if (input.name !== undefined && !input.name.trim())
    throw new AdapterError('Enter a name.', 'name');
  if (input.phone !== undefined && !/^\+?[0-9 ]{10,15}$/.test(input.phone))
    throw new AdapterError('Enter a 10-digit phone number.', 'phone');
  if (input.email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email))
    throw new AdapterError('Enter a valid email.', 'email');
  if (
    input.email &&
    rows().some((e) => e.email.toLowerCase() === input.email!.toLowerCase() && e.id !== target?.id)
  )
    throw new AdapterError('Someone already uses this email.', 'email');
  const newRole = input.role ?? target?.role;
  if (newRole && roleLevel(newRole) >= roleLevel(self.role))
    throw new AdapterError('Role must be below your own.', 'role');
  if (input.hqId && !hqsFor(self.id).some((h) => h.id === input.hqId))
    throw new AdapterError('Pick an HQ in your team.', 'hqId');
  if (input.managerId !== undefined && input.managerId !== null) {
    const m = rows().find((e) => e.id === input.managerId);
    if (!m || !sub.has(m.id)) throw new AdapterError('Pick a manager in your team.', 'managerId');
    if (newRole && roleLevel(m.role) <= roleLevel(newRole))
      throw new AdapterError('The manager must be senior to this role.', 'managerId');
    if (target && subtreeIds(rows(), target.id).has(m.id))
      throw new AdapterError('Someone can’t report to their own team.', 'managerId');
  }
  if (target && target.managerId !== null && !sub.has(target.id))
    throw new AdapterError('This person is not in your team.');
  if (target?.id === self.id) throw new AdapterError('You can’t change your own record here.');
}

/** HQs used anywhere in the caller's subtree. */
function hqsFor(selfId: string): Hq[] {
  const sub = subtreeIds(rows(), selfId);
  const ids = new Set(
    rows()
      .filter((e) => sub.has(e.id))
      .map((e) => e.hqId),
  );
  return HQS.filter((h) => ids.has(h.id));
}

const mockTeamAdapter = {
  /** GET /v1/org/tree */
  async tree(role: Role): Promise<OrgTree> {
    await delay();
    const self = me(role);
    const sub = subtreeIds(rows(), self.id);
    return {
      rootId: self.id,
      nodes: rows()
        .filter((e) => sub.has(e.id))
        .map((e) => ({ ...e })),
    };
  },
  /** GET /v1/org/unassigned?cursor&limit: people with no reporting manager, visible to any manager to assign. */
  async unassigned(
    role: Role,
    { cursor, limit = 50 }: { cursor?: string; limit?: number } = {},
  ): Promise<Page<Employee>> {
    await delay();
    me(role);
    const all = rows().filter((e) => e.managerId === null && e.role !== 'director');
    const start = cursor ? Number(cursor) : 0;
    const items = all.slice(start, start + limit).map((e) => ({ ...e }));
    return {
      items,
      total: all.length,
      nextCursor: start + limit < all.length ? String(start + limit) : null,
    };
  },
  /** GET /v1/hqs?scope=mine */
  async hqs(role: Role): Promise<Hq[]> {
    await delay();
    return hqsFor(me(role).id);
  },
  allHqs: () => HQS,
  /** POST /v1/employees */
  async create(role: Role, input: EmployeeInput): Promise<Employee> {
    await delay();
    if (!input.hqId) throw new AdapterError('Pick an HQ.', 'hqId');
    if (!input.managerId) throw new AdapterError('Pick a manager.', 'managerId');
    check(role, input);
    const n = rows().length + 1;
    const e: Employee = {
      ...input,
      id: `emp-new-${n}`,
      employeeCode: `ARI${2000 + n}`,
      active: true,
      invited: true,
    };
    rows().push(e);
    return { ...e };
  },
  /** PATCH /v1/employees/{id}: edit, move (managerId/hqId), deactivate (active=false). */
  async update(role: Role, id: string, patch: EmployeePatch): Promise<Employee> {
    await delay();
    const target = rows().find((e) => e.id === id);
    if (!target) throw new AdapterError('Not found.');
    check(role, patch, target);
    Object.assign(target, patch);
    return { ...target };
  },
  /** POST /v1/employees/{id}/invite (mock: link returned, like INVITE_RETURN_LINK=true). */
  async invite(role: Role, id: string): Promise<InviteResult> {
    await delay();
    const self = me(role);
    const target = rows().find((e) => e.id === id);
    if (!target || target.id === self.id || (target.managerId !== null && !subtreeIds(rows(), self.id).has(id)))
      throw new AdapterError('This person is not in your team.');
    if (!target.invited) throw new AdapterError(`${target.name} already has a login.`);
    const { token, expiresAt } = issueMockInvite(id);
    return { id, name: target.name, expiresAt, inviteUrl: `${window.location.origin}/invite?token=${token}` };
  },
  /** Mock of POST /v1/employees/invite-bulk: each row runs the single-create rules (partial success). */
  async inviteBulk(role: Role, inputs: EmployeeInput[], onProgress?: (done: number) => void): Promise<BulkInviteResult> {
    const out: BulkInviteRow[] = [];
    const seen = new Set<string>();
    for (const [index, input] of inputs.entries()) {
      const email = input.email.trim().toLowerCase();
      const base = { index, name: input.name, email: input.email, inviteUrl: null };
      if (seen.has(email)) {
        out.push({ ...base, status: 'skipped', code: 'DUPLICATE_IN_BATCH', message: 'Listed twice in this batch.' });
        continue;
      }
      seen.add(email);
      if (rows().some((e) => e.email.toLowerCase() === email)) {
        out.push({ ...base, status: 'skipped', code: 'CONFLICT', message: 'Someone with this email already exists.' });
        continue;
      }
      try {
        // Phone is optional in bulk (EmployeeCreate.phone nullable); the single-add form requires it.
        const { phone, ...rest } = input;
        const e = await mockTeamAdapter.create(role, (phone ? input : rest) as EmployeeInput);
        if (!phone) {
          e.phone = '';
          const row = rows().find((x) => x.id === e.id);
          if (row) row.phone = '';
        }
        const { token } = issueMockInvite(e.id);
        out.push({ ...base, status: 'invited', code: null, message: null, inviteUrl: `${window.location.origin}/invite?token=${token}` });
      } catch (err) {
        out.push({ ...base, status: 'failed', code: 'VALIDATION', message: err instanceof Error ? err.message : 'Not valid.' });
      }
      onProgress?.(index + 1);
    }
    return { rows: out, summary: summarize(out) };
  },
  /** Roles a caller may create: strictly below their own. */
  creatableRoles(role: Role): SalesRole[] {
    const lvl = roleLevel(role);
    return (
      [
        'business_manager',
        'area_business_manager',
        'regional_business_manager',
        'zonal_business_manager',
        'sales_manager',
        'general_manager',
        'vice_president',
      ] as SalesRole[]
    ).filter((r) => roleLevel(r) < lvl);
  },
};

/** Mock mode: the in-memory sample org. Real mode: the API (NEXT_PUBLIC_API_MODE=real). */
export const teamAdapter = REAL ? apiTeamAdapter : mockTeamAdapter;
