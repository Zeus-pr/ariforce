import { http, HttpResponse } from 'msw';
import type { Me } from '../schemas/auth';
import { ROLE_RANK, type RoleKey } from '../schemas/roles';
import {
  EmployeeCreate,
  EmployeeUpdate,
  InviteAccept,
  ManagerAssign,
  MIN_MANAGER_RANK,
  hierarchyRank,
  type TeamNode,
} from '../schemas/team';
import * as fx from './fixtures';

type Emp = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  employeeCode: string | null;
  designation: string | null;
  joinedOn: string | null;
  roles: RoleKey[];
  managerId: string | null;
  territoryIds: string[];
  status: 'invited' | 'active' | 'suspended';
  version: number;
};
const emps: Emp[] = fx.mockUsers.map((u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: null,
  employeeCode: u.employeeCode,
  designation: null,
  joinedOn: null,
  roles: u.roles,
  managerId: u.managerId,
  territoryIds: u.territoryIds,
  status: 'active',
  version: 1,
}));
const invites = new Map<string, { id: string; userId: string; expiresAt: string; used: boolean }>();

const e = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });
const rank = (x: Emp) => hierarchyRank(x.roles);
const wide = (p: Me) => p.roles.includes('director');

function subtree(rootId: string) {
  const ids = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const u of emps)
      if (u.managerId && ids.has(u.managerId) && !ids.has(u.id)) {
        ids.add(u.id);
        grew = true;
      }
  }
  return ids;
}
function terrSubtree(ids: string[]) {
  const out = new Set(ids);
  for (let grew = true; grew;) {
    grew = false;
    for (const t of fx.territories)
      if (t.parentId && out.has(t.parentId) && !out.has(t.id)) {
        out.add(t.id);
        grew = true;
      }
  }
  return out;
}
const scopeTerr = (p: Me) =>
  wide(p) ? new Set(fx.territories.map((t) => t.id)) : terrSubtree(p.territoryIds);

function node(u: Emp, depth: number): TeamNode {
  const top = [...u.roles].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0] ?? null;
  return {
    id: u.id,
    name: u.name,
    role: top,
    roles: u.roles,
    designation: u.designation,
    joinedOn: u.joinedOn,
    employeeCode: u.employeeCode,
    phone: u.phone,
    email: u.email,
    status: u.status,
    managerId: u.managerId,
    depth,
    directReportCount: emps.filter((x) => x.managerId === u.id && x.status !== 'suspended').length,
    version: u.version,
    territories: u.territoryIds.flatMap((id) => {
      const t = fx.territories.find((x) => x.id === id);
      return t
        ? [
            {
              id: t.id,
              name: t.name,
              code: t.code,
              level: t.level,
              city: null,
              state: null,
              lat: null,
              lng: null,
            },
          ]
        : [];
    }),
  };
}

/** Same rules as the API (docs/RBAC.md "Team and employees"). */
export function teamHandlers(baseUrl: string, who: (r: Request) => Me | undefined) {
  const me = (r: Request) => who(r);
  const manageable = (p: Me, target: Emp) => {
    const unassigned = !target.managerId && target.territoryIds.some((t) => scopeTerr(p).has(t));
    return (
      target.id !== p.id &&
      rank(target) < hierarchyRank(p.roles) &&
      (wide(p) || subtree(p.id).has(target.id) || unassigned)
    );
  };
  return [
    http.get(`${baseUrl}/v1/team`, ({ request }) => {
      const p = me(request);
      if (!p) return e(401, 'UNAUTHENTICATED', 'Sign in required');
      const nodes: TeamNode[] = [];
      const walk = (id: string, d: number) => {
        const u = emps.find((x) => x.id === id);
        if (!u) return;
        nodes.push(node(u, d));
        for (const c of emps.filter((x) => x.managerId === id && rank(x) > 0)) walk(c.id, d + 1);
      };
      walk(p.id, 0);
      const st = scopeTerr(p);
      const unassigned =
        hierarchyRank(p.roles) >= MIN_MANAGER_RANK
          ? emps
              .filter(
                (u) =>
                  !u.managerId &&
                  u.id !== p.id &&
                  rank(u) > 0 &&
                  rank(u) < hierarchyRank(p.roles) &&
                  (wide(p) || u.territoryIds.some((t) => st.has(t))),
              )
              .map((u) => node(u, -1))
          : [];
      return HttpResponse.json({ rootId: p.id, nodes, unassigned });
    }),
    http.post(`${baseUrl}/v1/employees`, async ({ request }) => {
      const p = me(request);
      if (!p) return e(401, 'UNAUTHENTICATED', 'Sign in required');
      const b = EmployeeCreate.safeParse(await request.json());
      if (!b.success) return e(422, 'VALIDATION', b.error.issues[0]?.message ?? 'Invalid');
      const r = hierarchyRank(p.roles);
      if (r < MIN_MANAGER_RANK) return e(403, 'FORBIDDEN', 'Only ABM and above can add employees');
      if (!(ROLE_RANK[b.data.role] > 0 && ROLE_RANK[b.data.role] < r))
        return e(403, 'FORBIDDEN', 'Role must be below your own');
      const st = scopeTerr(p);
      if (b.data.territoryIds.some((t) => !st.has(t)))
        return e(403, 'FORBIDDEN', 'Territory outside your subtree');
      const mgrId = b.data.managerId ?? p.id;
      const mgr = emps.find((x) => x.id === mgrId);
      if (!mgr || !(wide(p) || subtree(p.id).has(mgrId)) || rank(mgr) <= ROLE_RANK[b.data.role])
        return e(403, 'FORBIDDEN', 'Manager must be you or above the new role in your subtree');
      if (emps.some((x) => x.email.toLowerCase() === b.data.email.toLowerCase()))
        return e(409, 'CONFLICT', 'Email already exists');
      const u: Emp = {
        id: crypto.randomUUID(),
        name: b.data.name,
        email: b.data.email,
        phone: b.data.phone,
        employeeCode: b.data.employeeCode,
        designation: b.data.designation,
        joinedOn: b.data.joinedOn,
        roles: [b.data.role],
        managerId: mgrId,
        territoryIds: b.data.territoryIds,
        status: 'invited',
        version: 1,
      };
      emps.push(u);
      const inv = {
        id: crypto.randomUUID(),
        userId: u.id,
        expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
        used: false,
      };
      invites.set(`mock-invite-${inv.id}`, inv);
      return HttpResponse.json(
        {
          employee: node(u, 1),
          invite: { ...inv, used: undefined, inviteUrl: `/invite?token=mock-invite-${inv.id}` },
        },
        { status: 201 },
      );
    }),
    http.patch(`${baseUrl}/v1/employees/:id`, async ({ request, params }) => {
      const p = me(request);
      if (!p) return e(401, 'UNAUTHENTICATED', 'Sign in required');
      const u = emps.find((x) => x.id === params.id);
      if (!u) return e(404, 'NOT_FOUND', 'Not found');
      const b = EmployeeUpdate.safeParse(await request.json());
      if (!b.success) return e(422, 'VALIDATION', b.error.issues[0]?.message ?? 'Invalid');
      if (!manageable(p, u)) return e(403, 'FORBIDDEN', 'Not below you in your subtree');
      if (b.data.version !== u.version) return e(409, 'VERSION_CONFLICT', 'Stale version');
      const r = hierarchyRank(p.roles);
      if (b.data.role && !(ROLE_RANK[b.data.role] > 0 && ROLE_RANK[b.data.role] < r))
        return e(403, 'FORBIDDEN', 'Role must be below your own');
      if (b.data.territoryIds?.some((t) => !scopeTerr(p).has(t)))
        return e(403, 'FORBIDDEN', 'Territory outside your subtree');
      if (b.data.managerId) {
        if (subtree(u.id).has(b.data.managerId)) return e(409, 'CONFLICT', 'Reporting cycle');
        if (!(wide(p) || subtree(p.id).has(b.data.managerId)))
          return e(403, 'FORBIDDEN', 'Manager outside your subtree');
      }
      Object.assign(u, {
        ...b.data,
        roles: b.data.role ? [b.data.role] : u.roles,
        version: u.version + 1,
      });
      return HttpResponse.json(node(u, 1));
    }),
    http.post(`${baseUrl}/v1/team/:id/manager`, async ({ request, params }) => {
      const p = me(request);
      if (!p) return e(401, 'UNAUTHENTICATED', 'Sign in required');
      const u = emps.find((x) => x.id === params.id);
      if (!u) return e(404, 'NOT_FOUND', 'Not found');
      const b = ManagerAssign.safeParse(await request.json());
      if (!b.success) return e(422, 'VALIDATION', 'Invalid');
      if (!manageable(p, u)) return e(403, 'FORBIDDEN', 'Not in your scope');
      const mgr = emps.find((x) => x.id === b.data.managerId);
      if (!mgr || !(wide(p) || subtree(p.id).has(mgr.id)) || rank(mgr) <= rank(u))
        return e(403, 'FORBIDDEN', 'Manager must be you or above them in your subtree');
      if (subtree(u.id).has(mgr.id)) return e(409, 'CONFLICT', 'Reporting cycle');
      u.managerId = mgr.id;
      u.version += 1;
      return HttpResponse.json(node(u, 1));
    }),
    http.post(`${baseUrl}/v1/invites/accept`, async ({ request }) => {
      const b = InviteAccept.safeParse(await request.json());
      if (!b.success) return e(422, 'VALIDATION', 'Invalid');
      const inv = invites.get(b.data.token);
      if (!inv || inv.used || Date.parse(inv.expiresAt) < Date.now())
        return e(404, 'INVITE_INVALID', 'Invalid, used, revoked or expired invite');
      inv.used = true;
      const u = emps.find((x) => x.id === inv.userId)!;
      u.status = 'active';
      return HttpResponse.json({ userId: u.id, email: u.email });
    }),
  ];
}
