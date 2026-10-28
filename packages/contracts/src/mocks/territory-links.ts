import { http, HttpResponse } from 'msw';
import * as z from 'zod';
import { planTerritoryLinks, territoryLinkResult } from '../import/territory-links';
import type { Me } from '../schemas/auth';
import { TerritoryLinkImportRequest } from '../schemas/imports';
import type { Chemist, Doctor } from '../schemas/masters';
import * as fx from './fixtures';

/**
 * POST /v1/imports/territory-links: same planner as the API. Fixtures have no headquarter level, so
 * an `area` counts as an HQ here (like the other mocks). Created territories are appended to
 * fixtures.territories (so GET /v1/territories shows them); links are set on the mock doctor and
 * chemist rows the list handlers serve.
 */
export function territoryLinkHandlers(
  baseUrl: string,
  who: (r: Request) => Me | undefined,
  doctors: Doctor[],
  chemists: Chemist[],
) {
  return [
    http.post(`${baseUrl}/v1/imports/territory-links`, async ({ request }) => {
      const p = who(request);
      if (!p)
        return HttpResponse.json(
          { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } },
          { status: 401 },
        );
      const wide = p.roles.includes('director') || p.roles.includes('system_admin');
      const perms = ['imports:write', 'territories:write', 'masters:write'] as const;
      if (!wide || perms.some((x) => !p.permissions.includes(x)))
        return HttpResponse.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'Only company-wide roles can import territory links',
            },
          },
          { status: 403 },
        );
      const b = TerritoryLinkImportRequest.safeParse(await request.json().catch(() => null));
      if (!b.success)
        return HttpResponse.json(
          {
            error: {
              code: 'VALIDATION',
              message: 'Invalid body',
              details: z.treeifyError(b.error),
            },
          },
          { status: 422 },
        );
      const live = fx.territories.filter((t) => !t.deletedAt);
      const key = (s: string) =>
        s
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
      const plan = planTerritoryLinks(
        b.data.rows,
        {
          territoryByCode: (c) => live.find((t) => t.code.toUpperCase() === c),
          isHq: (l) => l === 'headquarter' || l === 'area',
          territories: live
            .filter((t) => t.level === 'territory' && t.parentId)
            .map((t) => ({
              id: t.id,
              parentId: t.parentId!,
              key: key(t.name),
              code: t.code,
              name: t.name,
            })),
          masters: [
            ...doctors
              .filter((d) => !d.deletedAt)
              .map((d) => ({
                entity: 'doctor' as const,
                id: d.id,
                hqId: d.territoryId,
                name: d.name,
                localTerritoryId: d.localTerritoryId,
              })),
            ...chemists
              .filter((c) => !c.deletedAt)
              .map((c) => ({
                entity: 'chemist' as const,
                id: c.id,
                hqId: c.territoryId,
                name: c.name,
                localTerritoryId: c.localTerritoryId,
              })),
          ],
          takenCodes: new Set(fx.territories.map((t) => t.code.toUpperCase())),
          newId: () => crypto.randomUUID(),
        },
        b.data.onLinked,
      );
      if (!b.data.dryRun) {
        const ts = new Date().toISOString();
        for (const c of plan.create) {
          const parent = fx.territories.find((t) => t.id === c.hqId)!;
          fx.territories.push({
            id: c.id,
            companyId: fx.COMPANY_ID,
            createdAt: ts,
            updatedAt: ts,
            deletedAt: null,
            version: 1,
            parentId: c.hqId,
            level: 'territory',
            code: c.code,
            name: c.name,
            path: `${parent.path}.${c.id}`,
            centroid: null,
          });
        }
        for (const l of plan.links) {
          const row = (l.entity === 'doctor' ? doctors : chemists).find((r) => r.id === l.id)!;
          Object.assign(row, {
            localTerritoryId: l.territoryId,
            version: row.version + 1,
            updatedAt: ts,
          });
        }
      }
      return HttpResponse.json(
        territoryLinkResult(plan, {
          dryRun: b.data.dryRun,
          fileName: b.data.fileName,
          fileKey: b.data.fileKey,
          onLinked: b.data.onLinked,
        }),
        { status: b.data.dryRun ? 200 : 201 },
      );
    }),
  ];
}
