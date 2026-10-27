/* eslint-disable @typescript-eslint/no-explicit-any */
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TeamPerformanceQuery, TeamProfileExportQuery } from '../src';
import { findMockUser } from '../src/mocks/fixtures';
import { createHandlers } from '../src/mocks';

const BASE = 'http://profile.test';
const server = setupServer(...createHandlers(BASE));
beforeAll(() => server.listen());
afterAll(() => server.close());
const get = (who: string, path: string) =>
  fetch(`${BASE}${path}`, { headers: { 'x-mock-user': `${who}@demo.ariforce.in` } });
const id = (k: string) => findMockUser(k)!.id;

describe('team profile contracts + mocks', () => {
  it('query rules', () => {
    expect(TeamPerformanceQuery.parse({}).granularity).toBe('month');
    expect(TeamPerformanceQuery.safeParse({ from: '2026-05-01', to: '2026-04-01' }).success).toBe(
      false,
    );
    expect(TeamProfileExportQuery.safeParse({ format: 'csv' }).success).toBe(false);
    expect(TeamProfileExportQuery.safeParse({ format: 'pdf', granularity: 'week' }).success).toBe(
      true,
    );
  });

  it('scope matrix', async () => {
    const p = (who: string, target: string) => `/v1/team/members/${id(target)}/profile`;
    expect((await get('abm', p('abm', 'bm'))).status).toBe(200);
    expect((await get('abm', p('abm', 'abm'))).status).toBe(200);
    expect((await get('abm', p('abm', 'rbm'))).status).toBe(404);
    expect((await get('director', p('director', 'bm'))).status).toBe(200);
    expect((await get('bm', p('bm', 'bm'))).status).toBe(200);
    expect((await get('bm', p('bm', 'abm'))).status).toBe(403);
    expect((await get('sysadmin', p('sysadmin', 'bm'))).status).toBe(403);
    expect((await get('accountant', p('accountant', 'bm'))).status).toBe(403);
    expect((await get('director', p('director', 'accountant'))).status).toBe(404);
  });

  it('profile, performance, outlets', async () => {
    const prof: any = await (await get('abm', `/v1/team/members/${id('bm')}/profile`)).json();
    expect(prof.member.id).toBe(id('bm'));
    expect(prof.manager.id).toBe(id('abm'));
    const perf: any = await (
      await get('abm', `/v1/team/members/${id('bm')}/performance?granularity=week`)
    ).json();
    expect(perf.buckets).toHaveLength(8);
    expect(perf.buckets.at(-1).label).toMatch(/^\d{4}-W\d{2}$/);
    expect(perf.buckets[0].metrics.map((m: any) => m.kpi)).not.toContain('coverage_pct');
    const docs: any = await (
      await get('abm', `/v1/team/members/${id('bm')}/doctors?includeTotal=true`)
    ).json();
    expect(docs.items.length).toBe(docs.total);
  });
});
