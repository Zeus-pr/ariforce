/**
 * REAL-mode team adapter: the Architect's endpoints (GET /v1/team, POST /v1/employees,
 * PATCH /v1/employees/{id}, PUT /v1/team/{id}/manager). Same surface as the mock adapter so the
 * My Team UI does not change. "HQ" in the UI = the employee's first assigned territory.
 */
import type { components } from '@ariforce/contracts';
import { api } from '@/lib/api';
import { roleLevel, type Role, type SalesRole } from '@/lib/roles';
import {
  AdapterError,
  type Employee,
  type EmployeeInput,
  type EmployeePatch,
  type Hq,
  type InviteResult,
  type OrgTree,
  type Page,
} from './types';

type Node = components['schemas']['TeamNode'];

const versions = new Map<string, number>();
let hqCache: Hq[] = [];
let last: { nodes: Node[]; unassigned: Node[] } | null = null;

const toEmployee = (n: Node, rootId?: string): Employee => {
  versions.set(n.id, n.version);
  return {
    id: n.id,
    name: n.name,
    role: (n.role ?? 'business_manager') as SalesRole,
    employeeCode: n.employeeCode ?? '',
    phone: n.phone ?? '',
    email: n.email,
    hqId: n.territories[0]?.id ?? null,
    managerId: n.id === rootId ? null : n.managerId,
    active: n.status !== 'suspended',
    invited: n.status === 'invited',
  };
};

function fail(error: unknown): never {
  const e = (error as { error?: { message?: string; details?: { field?: string }[] } })?.error;
  const field = e?.details?.[0]?.field;
  const map: Record<string, keyof EmployeeInput> = {
    territoryIds: 'hqId',
    managerId: 'managerId',
    email: 'email',
    phone: 'phone',
    name: 'name',
    role: 'role',
  };
  throw new AdapterError(
    e?.message ?? 'Could not reach the server.',
    field ? map[field] : undefined,
  );
}

async function load() {
  const { data, error } = await api.GET('/v1/team');
  if (error || !data) fail(error);
  last = { nodes: data.nodes, unassigned: data.unassigned };
  const seen = new Map<string, Hq>();
  for (const n of [...data.nodes, ...data.unassigned])
    for (const t of n.territories)
      seen.set(t.id, { id: t.id, name: t.name, city: t.city ?? '', state: t.state ?? '' });
  hqCache = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  return data;
}

/** The API builds links from WEB_ORIGIN; a relative one is made absolute for copying. */
const absolute = (u: string | null | undefined) =>
  !u ? null : /^https?:\/\//.test(u) ? u : new URL(u, window.location.origin).toString();

export const apiTeamAdapter = {
  async tree(_role: Role): Promise<OrgTree> {
    const data = await load();
    return { rootId: data.rootId, nodes: data.nodes.map((n) => toEmployee(n, data.rootId)) };
  },
  /** The contract returns Unassigned with the tree (not paged); wrapped as one page. */
  async unassigned(_role: Role): Promise<Page<Employee>> {
    const items = (last ?? (await load())).unassigned.map((n) => toEmployee(n));
    return { items, total: items.length, nextCursor: null };
  },
  async hqs(_role: Role): Promise<Hq[]> {
    if (!last) await load();
    return hqCache;
  },
  allHqs: () => hqCache,
  async create(_role: Role, input: EmployeeInput): Promise<Employee> {
    if (!input.hqId) throw new AdapterError('Pick an HQ.', 'hqId');
    if (!input.managerId) throw new AdapterError('Pick a manager.', 'managerId');
    const { data, error } = await api.POST('/v1/employees', {
      body: {
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        role: input.role,
        territoryIds: [input.hqId],
        managerId: input.managerId,
      } as never,
    });
    if (error || !data) fail(error);
    return toEmployee(data.employee);
  },
  async update(_role: Role, id: string, patch: EmployeePatch): Promise<Employee> {
    const version = versions.get(id);
    if (version === undefined) throw new AdapterError('Reload the page and try again.');
    // Assigning someone from Unassigned uses the dedicated endpoint.
    if (
      Object.keys(patch).length === 1 &&
      patch.managerId &&
      last?.unassigned.some((n) => n.id === id)
    ) {
      const { data, error } = await api.POST('/v1/team/{id}/manager', {
        params: { path: { id } },
        body: { managerId: patch.managerId },
      });
      if (error || !data) fail(error);
      return toEmployee(data as unknown as Node);
    }
    const body: Record<string, unknown> = { version };
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.phone !== undefined) body.phone = patch.phone || null;
    if (patch.role !== undefined) body.role = patch.role;
    if (patch.hqId) body.territoryIds = [patch.hqId];
    if (patch.managerId) body.managerId = patch.managerId;
    if (patch.active !== undefined) body.status = patch.active ? 'active' : 'suspended';
    const { data, error } = await api.PATCH('/v1/employees/{id}', {
      params: { path: { id } },
      body: body as never,
    });
    if (error || !data) fail(error);
    return toEmployee(data as unknown as Node);
  },
  /** POST /v1/employees/{id}/invite: revokes earlier links. */
  async invite(_role: Role, id: string): Promise<InviteResult> {
    const { data, error } = await api.POST('/v1/employees/{id}/invite', { params: { path: { id } } });
    if (error || !data) fail(error);
    const name = [...(last?.nodes ?? []), ...(last?.unassigned ?? [])].find((n) => n.id === id)?.name ?? '';
    return { id, name, expiresAt: data.expiresAt, inviteUrl: absolute(data.inviteUrl) };
  },
  creatableRoles(role: Role): SalesRole[] {
    return (
      [
        'zonal_business_manager',
        'regional_business_manager',
        'area_business_manager',
        'business_manager',
      ] as const
    )
      .concat(['sales_manager', 'general_manager', 'vice_president'] as never)
      .filter((r) => roleLevel(r) < roleLevel(role))
      .sort((a, b) => roleLevel(b) - roleLevel(a)) as SalesRole[];
  },
};
