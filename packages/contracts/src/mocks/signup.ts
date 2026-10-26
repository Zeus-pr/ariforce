import type * as z from 'zod';
import { http, HttpResponse } from 'msw';
import type { Me } from '../schemas/auth';
import { ROLE_RANK } from '../schemas/roles';
import {
  AUTH_STATE_CODES,
  SignupApprove,
  SignupReject,
  SignupRequest,
  SignupOptions,
  SignupRequestCreate,
} from '../schemas/signup';
import { MIN_MANAGER_RANK, hierarchyRank, isHierarchyRole } from '../schemas/team';
import * as fx from './fixtures';

/**
 * Mock sign-up requests. Same states and error codes as the API. Simplification: an ABM+ sees
 * requests for roles below theirs regardless of territory/manager (the API shows unassigned
 * requests to every ABM+ above the role, and assigned ones only within the approver's subtree).
 */
type Req = z.infer<typeof SignupRequest> & { password: string };
const reqs: Req[] = [];
const e = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });
const view = ({ password: _p, ...r }: Req) => SignupRequest.parse(r);
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${(0xa00000000000 + ++seq).toString(16)}`;

export function signupHandlers(baseUrl: string, who: (r: Request) => Me | undefined) {
  const admin = (p: Me) => p.roles.includes('system_admin');
  const canDecide = (p: Me, r: Req) => {
    if (r.userId === p.id) return false;
    if (admin(p)) return true;
    const rr = ROLE_RANK[r.requestedRole];
    return isHierarchyRole(r.requestedRole) && rr > 0 && rr < hierarchyRank(p.roles);
  };
  const reviewer = (request: Request) => {
    const p = who(request);
    if (!p) return { res: e(401, 'UNAUTHENTICATED', 'Sign in required') };
    if (!admin(p) && hierarchyRank(p.roles) < MIN_MANAGER_RANK)
      return { res: e(403, 'FORBIDDEN', 'Only system admins and ABM and above review sign-ups') };
    return { p };
  };
  const find = (p: Me, id: string) => {
    const r = reqs.find((x) => x.id === id);
    if (!r || !canDecide(p, r)) return { res: e(404, 'NOT_FOUND', 'Sign-up request not found') };
    if (r.status !== 'pending') return { res: e(409, 'CONFLICT', 'Request was already decided') };
    return { r };
  };
  return [
    http.get(`${baseUrl}/v1/auth/sign-up-options`, () =>
      HttpResponse.json(
        SignupOptions.parse({
          territories: fx.territories.map((t) => ({ id: t.id, name: t.name, code: t.code })),
          managers: fx.mockUsers
            .filter((u) =>
              u.roles.some((r) => isHierarchyRole(r) && ROLE_RANK[r] >= MIN_MANAGER_RANK),
            )
            .map((u) => ({
              id: u.id,
              name: u.name,
              role: u.roles.reduce((a, b) => (ROLE_RANK[b] > ROLE_RANK[a] ? b : a)),
            })),
        }),
      ),
    ),
    http.post(`${baseUrl}/v1/auth/sign-up-request`, async ({ request }) => {
      const b = SignupRequestCreate.safeParse(await request.json().catch(() => null));
      if (!b.success) return e(422, 'VALIDATION', 'Invalid sign-up request');
      const email = b.data.email.toLowerCase();
      if (fx.findMockUser(email) || reqs.some((r) => r.email === email))
        return e(
          409,
          AUTH_STATE_CODES.unavailable,
          'We could not create an account with these details. If you already have an account, sign in or contact your administrator.',
        );
      reqs.push({
        id: uuid(),
        userId: uuid(),
        name: b.data.name,
        email,
        phone: b.data.phone,
        requestedRole: b.data.requestedRole,
        requestedTerritoryId: b.data.territoryId,
        requestedManagerId: b.data.managerId,
        status: 'pending',
        approvedRole: null,
        decidedBy: null,
        decidedAt: null,
        reason: null,
        createdAt: new Date().toISOString(),
        password: b.data.password,
      });
      return HttpResponse.json(
        {
          status: 'pending',
          message: 'Request received. You can sign in once an administrator approves it.',
        },
        { status: 202 },
      );
    }),
    // Pending/rejected self sign-ups: better-auth style body { code, message }; others fall through.
    http.post(`${baseUrl}/v1/auth/sign-in/email`, async ({ request }) => {
      const b = (await request
        .clone()
        .json()
        .catch(() => null)) as { email?: string } | null;
      const r = reqs.find((x) => x.email === b?.email?.toLowerCase());
      if (!r) return undefined;
      if (r.status === 'pending')
        return HttpResponse.json(
          { code: AUTH_STATE_CODES.pending, message: 'Your account is awaiting approval' },
          { status: 403 },
        );
      if (r.status === 'rejected')
        return HttpResponse.json(
          { code: AUTH_STATE_CODES.rejected, message: 'Your sign-up request was not approved' },
          { status: 403 },
        );
      return HttpResponse.json(
        { token: `mock:${r.approvedRole}`, user: { id: r.userId, email: r.email, name: r.name } },
        { headers: { 'set-auth-token': `mock:${r.approvedRole}` } },
      );
    }),
    http.get(`${baseUrl}/v1/signup-requests`, ({ request }) => {
      const g = reviewer(request);
      if (g.res) return g.res;
      const status = new URL(request.url).searchParams.get('status') ?? 'pending';
      return HttpResponse.json({
        items: reqs.filter((r) => r.status === status && canDecide(g.p, r)).map(view),
      });
    }),
    http.post(`${baseUrl}/v1/signup-requests/:id/approve`, async ({ request, params }) => {
      const g = reviewer(request);
      if (g.res) return g.res;
      const f = find(g.p, String(params.id));
      if (f.res) return f.res;
      const b = SignupApprove.safeParse(await request.json().catch(() => null));
      if (!b.success) return e(422, 'VALIDATION', 'Invalid');
      const role = b.data.role;
      if (!admin(g.p)) {
        if (!isHierarchyRole(role) || ROLE_RANK[role] >= hierarchyRank(g.p.roles))
          return e(403, 'FORBIDDEN', 'Role must be a hierarchy role below your own');
      }
      if ((role === 'director' || !isHierarchyRole(role)) && b.data.managerId)
        return e(422, 'VALIDATION', 'This role has no manager');
      Object.assign(f.r, {
        status: 'approved',
        approvedRole: role,
        decidedBy: g.p.id,
        decidedAt: new Date().toISOString(),
      });
      return HttpResponse.json(view(f.r));
    }),
    http.post(`${baseUrl}/v1/signup-requests/:id/reject`, async ({ request, params }) => {
      const g = reviewer(request);
      if (g.res) return g.res;
      const f = find(g.p, String(params.id));
      if (f.res) return f.res;
      const b = SignupReject.safeParse(await request.json().catch(() => ({})));
      Object.assign(f.r, {
        status: 'rejected',
        reason: b.success ? b.data.reason : null,
        decidedBy: g.p.id,
        decidedAt: new Date().toISOString(),
      });
      return HttpResponse.json(view(f.r));
    }),
  ];
}
