import { http, HttpResponse } from 'msw';
import type { Me } from '../schemas/auth';
import { ROLE_RANK, type RoleKey } from '../schemas/roles';
import {
  EmployeeCreate,
  EmployeeUpdate,
  INVITE_BULK_MAX,
  InviteAccept,
  type InviteBulkResponse as IBR,
  ManagerAssign,
  MIN_MANAGER_RANK,
  hierarchyRank,
  type TeamNode,
} from '../schemas/team';
import * as fx from './fixtures';
import { KPI_KEYS, type KpiKey } from '../schemas/kpis';
import { WEEK_KPI_KEYS } from '../schemas/team-profile';
import {
  TeamMemberChemistPage,
  TeamMemberDoctorPage,
  TeamPerformance,
  TeamProfile,
  type PerformanceBucket as PB,
} from '../schemas/team-profile';
import type * as zz from 'zod';
type PerformanceBucket = zz.infer<typeof PB>;
type InviteBulkResponse = zz.infer<typeof IBR>;

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
  /** Single create (also used per row by invite-bulk). */
  const createOne = (p: Me, raw: unknown) => {
    const b = EmployeeCreate.safeParse(raw);
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
      return createOne(p, await request.json());
    }),
    http.post(`${baseUrl}/v1/employees/invite-bulk`, async ({ request }) => {
      const p = me(request);
      if (!p) return e(401, 'UNAUTHENTICATED', 'Sign in required');
      const rows = ((await request.json()) as { employees?: unknown } | null)?.employees;
      if (!Array.isArray(rows) || rows.length < 1 || rows.length > INVITE_BULK_MAX)
        return e(422, 'VALIDATION', `employees must be 1..${INVITE_BULK_MAX} rows`);
      if (hierarchyRank(p.roles) < MIN_MANAGER_RANK)
        return e(403, 'FORBIDDEN', 'Only ABM and above can add employees');
      const seen = new Set<string>();
      const results: InviteBulkResponse['results'] = [];
      for (const [index, raw] of rows.entries()) {
        const em = (raw as { email?: unknown } | null)?.email;
        const base = {
          index,
          email: typeof em === 'string' ? em : null,
          code: null,
          message: null,
          employeeId: null,
          inviteId: null,
          inviteUrl: null,
        };
        const key = typeof em === 'string' ? em.toLowerCase() : null;
        if (key && seen.has(key)) {
          results.push({
            ...base,
            status: 'skipped',
            code: 'DUPLICATE_IN_BATCH',
            message: 'Email or employee code repeated earlier in this batch',
          });
          continue;
        }
        if (key) seen.add(key);
        const res = createOne(p, raw);
        const j = (await res.json()) as {
          employee?: { id: string };
          invite?: { id: string; inviteUrl: string | null };
          error?: { code: string; message: string };
        };
        if (res.status === 201)
          results.push({
            ...base,
            status: 'invited',
            employeeId: j.employee!.id,
            inviteId: j.invite!.id,
            inviteUrl: j.invite!.inviteUrl,
          });
        else
          results.push({
            ...base,
            status: res.status === 409 ? 'skipped' : 'failed',
            code: j.error!.code,
            message: j.error!.message,
          });
      }
      const n = (st: string) => results.filter((r) => r.status === st).length;
      return HttpResponse.json({
        results,
        summary: { invited: n('invited'), skipped: n('skipped'), failed: n('failed') },
      });
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
      if (!b.success) return e(422, 'VALIDATION', b.error.issues[0]?.message ?? 'Invalid');
      const inv = invites.get(b.data.token);
      if (!inv) return e(404, 'INVITE_INVALID', 'This invite link is not valid');
      if (inv.used) return e(409, 'INVITE_USED', 'This invite has already been used');
      if (Date.parse(inv.expiresAt) <= Date.now())
        return e(410, 'INVITE_EXPIRED', 'This invite has expired; ask for a new one');
      inv.used = true;
      const u = emps.find((x) => x.id === inv.userId)!;
      u.status = 'active';
      return HttpResponse.json({ userId: u.id, email: u.email });
    }),
  ];
}

/**
 * Team member profile (#75) mocks. Same scope rules and error codes as the API; performance numbers are
 * deterministic placeholders (shape only), expenses are 0, doctors/chemists come from the fixtures.
 */
function isoWeek(d: string) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const y = t.getUTCFullYear();
  const w = 1 + Math.floor((t.getTime() - Date.UTC(y, 0, 1)) / (7 * 86_400_000));
  return `${y}-W${String(w).padStart(2, '0')}`;
}

export function teamProfileHandlers(baseUrl: string, who: (r: Request) => Me | undefined) {
  const B = `${baseUrl}/v1/team/members/:userId`;
  const guard = (request: Request, userId: string) => {
    const p = who(request);
    if (!p) return { res: e(401, 'UNAUTHENTICATED', 'Sign in required') };
    const self = p.id === userId;
    if (hierarchyRank(p.roles) === 0)
      return { res: e(403, 'FORBIDDEN', 'Team profiles need a hierarchy role') };
    if (
      !self &&
      (!(p.permissions as string[]).includes('reports:read') ||
        hierarchyRank(p.roles) < MIN_MANAGER_RANK)
    )
      return { res: e(403, 'FORBIDDEN', 'Only ABM and above with reports:read may view others') };
    const t = emps.find((x) => x.id === userId);
    if (!t || rank(t) === 0 || !(self || wide(p) || subtree(p.id).has(userId)))
      return { res: e(404, 'NOT_FOUND', 'Team member not found') };
    return { p, t };
  };
  const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const terrs = (t: Emp) => [...terrSubtree(t.territoryIds)];
  const pageOf = <T>(all: T[], url: URL) => {
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const off = Number(
      url.searchParams.get('cursor') ? atob(url.searchParams.get('cursor')!).slice(2) : 0,
    );
    const items = all.slice(off, off + limit);
    return {
      items,
      nextCursor: off + limit < all.length ? btoa(`o:${off + limit}`) : null,
      serverTime: new Date().toISOString(),
      ...(url.searchParams.get('includeTotal') === 'true' ? { total: all.length } : {}),
    };
  };
  const bucket = (label: string, from: string, to: string, week: boolean): PerformanceBucket => ({
    label,
    from,
    to,
    workingDays: week ? 6 : 26,
    metrics: (week ? [...WEEK_KPI_KEYS] : [...KPI_KEYS]).map((kpi) => ({
      kpi: kpi as KpiKey,
      value: null,
      numerator: 0,
      denominator: 0,
      unit: 'count' as const,
      target: null,
    })),
    attendance: { presentDays: 0, leaveDays: 0, holidayDays: 0, absentDays: 0 },
    expenses: null,
  });
  return [
    http.get(`${B}/profile`, ({ request, params }) => {
      const g = guard(request, String(params.userId));
      if (g.res) return g.res;
      const { depth: _d, ...member } = node(g.t, 0);
      const mgr = emps.find((x) => x.id === g.t.managerId);
      const ts = terrs(g.t);
      return HttpResponse.json(
        TeamProfile.parse({
          member,
          manager: mgr ? { id: mgr.id, name: mgr.name, role: node(mgr, 0).role } : null,
          hq: member.territories.at(-1) ?? null,
          counts: {
            doctors: fx.doctors.filter((d) => ts.includes(d.territoryId)).length,
            chemists: fx.chemists.filter((c) => ts.includes(c.territoryId)).length,
            directReports: member.directReportCount,
            subtreeSize: subtree(g.t.id).size - 1,
          },
          today: {
            date: today(),
            status: 'absent',
            punchInAt: null,
            punchOutAt: null,
            leave: null,
          },
          lastPunchInAt: null,
          canSeeExpenses:
            g.p.id === g.t.id ||
            (g.p.permissions as string[]).some(
              (x) => x === 'expenses:approve' || x === 'finance:read',
            ),
        }),
      );
    }),
    http.get(`${B}/performance`, ({ request, params }) => {
      const g = guard(request, String(params.userId));
      if (g.res) return g.res;
      const sp = new URL(request.url).searchParams;
      const week = sp.get('granularity') === 'week';
      const to = sp.get('to') ?? today();
      const buckets: PerformanceBucket[] = [];
      if (week) {
        let mon = to;
        while (new Date(`${mon}T00:00:00Z`).getUTCDay() !== 1)
          mon = new Date(Date.parse(`${mon}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
        for (let i = 7; i >= 0; i--) {
          const f = new Date(Date.parse(`${mon}T00:00:00Z`) - i * 7 * 86_400_000);
          const t = new Date(f.getTime() + 6 * 86_400_000);
          buckets.push(
            bucket(
              isoWeek(f.toISOString().slice(0, 10)),
              f.toISOString().slice(0, 10),
              t.toISOString().slice(0, 10),
              true,
            ),
          );
        }
      } else {
        const [y, m] = to.split('-').map(Number) as [number, number];
        for (let i = 5; i >= 0; i--) {
          const f = new Date(Date.UTC(y, m - 1 - i, 1));
          const t = new Date(Date.UTC(y, m - i, 0));
          buckets.push(
            bucket(
              f.toISOString().slice(0, 7),
              f.toISOString().slice(0, 10),
              t.toISOString().slice(0, 10),
              false,
            ),
          );
        }
      }
      return HttpResponse.json(
        TeamPerformance.parse({
          userId: g.t.id,
          granularity: week ? 'week' : 'month',
          from: buckets[0]!.from,
          to: buckets.at(-1)!.to,
          generatedAt: new Date().toISOString(),
          buckets,
          total: bucket('total', buckets[0]!.from, buckets.at(-1)!.to, week),
        }),
      );
    }),
    http.get(`${B}/doctors`, ({ request, params }) => {
      const g = guard(request, String(params.userId));
      if (g.res) return g.res;
      const ts = terrs(g.t);
      const url = new URL(request.url);
      const q = url.searchParams.get('q')?.toLowerCase();
      const all = fx.doctors
        .filter((d) => ts.includes(d.territoryId) && (!q || d.name.toLowerCase().includes(q)))
        .map((d) => ({
          id: d.id,
          name: d.name,
          qualification: d.qualification,
          specialty: fx.specialties.find((s) => s.id === d.specialtyId)?.name ?? null,
          category: fx.doctorCategories.find((c) => c.id === d.categoryId)?.name ?? null,
          territoryId: d.territoryId,
          territoryName: fx.territories.find((t) => t.id === d.territoryId)?.name ?? '',
          city: d.city,
          requiredVisits:
            fx.doctorCategories.find((c) => c.id === d.categoryId)?.visitsPerMonth ?? 1,
          visitsThisMonth: 0,
          lastVisitDate: null,
        }));
      return HttpResponse.json(TeamMemberDoctorPage.parse(pageOf(all, url)));
    }),
    http.get(`${B}/chemists`, ({ request, params }) => {
      const g = guard(request, String(params.userId));
      if (g.res) return g.res;
      const ts = terrs(g.t);
      const url = new URL(request.url);
      const all = fx.chemists
        .filter((c) => ts.includes(c.territoryId))
        .map((c) => ({
          id: c.id,
          name: c.name,
          territoryId: c.territoryId,
          territoryName: fx.territories.find((t) => t.id === c.territoryId)?.name ?? '',
          city: c.city,
          lastVisitDate: null,
        }));
      return HttpResponse.json(TeamMemberChemistPage.parse(pageOf(all, url)));
    }),
    http.get(`${B}/export`, ({ request, params }) => {
      const g = guard(request, String(params.userId));
      if (g.res) return g.res;
      const pdf = new URL(request.url).searchParams.get('format') === 'pdf';
      return new HttpResponse(pdf ? '%PDF-1.4 mock' : 'PK mock', {
        headers: {
          'content-type': pdf
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="team-profile.${pdf ? 'pdf' : 'xlsx'}"`,
        },
      });
    }),
  ];
}
