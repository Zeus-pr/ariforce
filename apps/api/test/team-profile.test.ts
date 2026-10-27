import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KPI_KEYS, WEEK_KPI_KEYS } from '@ariforce/contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { buckets } from '../src/team/team-profile.service';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const WHO = ['director', 'rbm', 'abm', 'bm', 'bm2', 'sysadmin', 'dh', 'accountant'] as const;
type Who = (typeof WHO)[number];

describe('performance buckets (unit)', () => {
  it('snaps months and ISO weeks', () => {
    const m = buckets('month', undefined, undefined, '2026-10-27');
    expect(m.map((b) => b.label)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(m.at(-1)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    const w = buckets('week', '2026-10-21', '2026-10-27', '2026-10-27');
    expect(w).toEqual([
      { label: '2026-W43', from: '2026-10-19', to: '2026-10-25' },
      { label: '2026-W44', from: '2026-10-26', to: '2026-11-01' },
    ]);
    expect(buckets('week', undefined, '2027-01-01', '2027-01-01').at(-1)!.label).toBe('2026-W53');
    expect(buckets('week', undefined, undefined, '2026-10-27')).toHaveLength(8);
  });
});

describe.skipIf(!OWNER || !APP)('team member profile (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  const tok = {} as Record<Who, string>;
  const id = {} as Record<Who, string>;
  const http = () => request(app.getHttpServer());
  const get = (who: Who, target: string, path = 'profile', q: Record<string, unknown> = {}) =>
    http().get(`/v1/team/members/${target}/${path}`).query(q).set({ authorization: tok[who] });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    owner = new Pool({ connectionString: OWNER });
    for (const who of WHO) {
      const email = `${who}@demo.ariforce.in`;
      id[who] = (await owner.query(`select id from users where email = $1`, [email])).rows[0].id;
      const res = await http().post('/v1/auth/sign-in/email').send({ email, password: PASSWORD });
      tok[who] = `Bearer ${res.headers['set-auth-token']}`;
    }
  });
  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  it('scope matrix', async () => {
    const cases: [Who, Who | string, number][] = [
      ['abm', 'bm', 200], // strictly below
      ['abm', 'abm', 200], // own
      ['abm', 'bm2', 404], // peer branch (bm2 reports to rbm)
      ['abm', 'rbm', 404], // above
      ['abm', 'director', 404],
      ['rbm', 'bm2', 200],
      ['rbm', 'bm', 200],
      ['director', 'bm', 200],
      ['director', 'rbm', 200],
      ['director', 'accountant', 404], // not a hierarchy user
      ['bm', 'bm', 200], // own profile, BM included
      ['bm', 'bm2', 403], // BM may not view others
      ['bm', 'abm', 403],
      ['sysadmin', 'bm', 403],
      ['sysadmin', 'sysadmin', 403],
      ['dh', 'bm', 403],
      ['accountant', 'bm', 403],
      ['director', '01930000-0000-7000-8000-00000000ffff', 404],
      ['director', 'not-a-uuid', 404],
    ];
    for (const [who, target, status] of cases) {
      const t = (WHO as readonly string[]).includes(target) ? id[target as Who] : target;
      for (const path of ['profile', 'performance', 'doctors', 'chemists']) {
        const r = await get(who, t, path);
        expect(r.status, `${who} -> ${target} ${path}: ${JSON.stringify(r.body)}`).toBe(status);
        if (status !== 200)
          expect(r.body.code ?? r.body.error?.code).toBe(
            status === 403 ? 'FORBIDDEN' : 'NOT_FOUND',
          );
      }
    }
  });

  it('profile shape, no payroll data, expenses visibility', async () => {
    const r = await get('abm', id.bm);
    expect(r.body.member.id).toBe(id.bm);
    expect(r.body.manager.id).toBe(id.abm);
    expect(r.body.counts.subtreeSize).toBeGreaterThanOrEqual(0);
    expect(typeof r.body.counts.doctors).toBe('number');
    expect(['present', 'absent', 'leave', 'holiday', 'incomplete', 'weekly_off']).toContain(
      r.body.today.status,
    );
    expect(JSON.stringify(r.body)).not.toMatch(/salary|bank|pan|aadhaar/i);
    if (r.body.hq)
      expect(r.body.member.territories.map((t: { id: string }) => t.id)).toContain(r.body.hq.id);
    const own = await get('bm', id.bm);
    expect(own.body.canSeeExpenses).toBe(true);
  });

  it('performance: month and week shapes, range limit', async () => {
    const m = await get('director', id.bm, 'performance');
    expect(m.status).toBe(200);
    expect(m.body.granularity).toBe('month');
    expect(m.body.buckets).toHaveLength(6);
    expect(m.body.total.label).toBe('total');
    expect(m.body.buckets[0].metrics.map((x: { kpi: string }) => x.kpi)).toEqual([...KPI_KEYS]);
    const w = await get('abm', id.bm, 'performance', {
      granularity: 'week',
      from: '2026-09-01',
      to: '2026-10-15',
    });
    expect(w.status, JSON.stringify(w.body)).toBe(200);
    expect(w.body.from).toBe('2026-08-31');
    expect(w.body.to).toBe('2026-10-18');
    expect(w.body.buckets[0].label).toBe('2026-W36');
    expect(w.body.buckets[0].metrics.map((x: { kpi: string }) => x.kpi)).toEqual([
      ...WEEK_KPI_KEYS,
    ]);
    const a = w.body.buckets[1].attendance;
    expect(a.presentDays + a.leaveDays + a.holidayDays + a.absentDays).toBeGreaterThanOrEqual(6);
    const own = await get('bm', id.bm, 'performance');
    expect(own.body.total.expenses).not.toBeNull();
    const tooLong = await get('abm', id.bm, 'performance', {
      granularity: 'week',
      from: '2025-01-01',
      to: '2026-10-01',
    });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.code ?? tooLong.body.error?.code).toBe('RANGE_TOO_LONG');
    const bad = await get('abm', id.bm, 'performance', { from: '2026-10-01', to: '2026-09-01' });
    expect(bad.status).toBe(422);
  });

  it('doctors and chemists are paged and scoped to the person', async () => {
    const all = await get('abm', id.bm, 'doctors', { includeTotal: true, limit: 200 });
    expect(all.status).toBe(200);
    expect(all.body.items.length).toBe(all.body.total);
    if (all.body.total > 1) {
      const p1 = await get('abm', id.bm, 'doctors', { limit: 1 });
      expect(p1.body.items).toHaveLength(1);
      expect(p1.body.nextCursor).toBeTruthy();
      const p2 = await get('abm', id.bm, 'doctors', { limit: 1, cursor: p1.body.nextCursor });
      expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);
    }
    for (const d of all.body.items) {
      expect(d).not.toHaveProperty('phone');
      expect(d).not.toHaveProperty('dateOfBirth');
    }
    const ch = await get('abm', id.bm, 'chemists', { includeTotal: true });
    expect(ch.status).toBe(200);
    expect(typeof ch.body.total).toBe('number');
    // The person's doctors are a subset of what the viewer's team covers.
    const abmDocs = await get('abm', id.abm, 'doctors', { includeTotal: true });
    expect(abmDocs.body.total).toBeGreaterThanOrEqual(0);
    const prof = await get('abm', id.bm);
    expect(prof.body.counts.doctors).toBe(all.body.total);
    expect(prof.body.counts.chemists).toBe(ch.body.total);
  });

  it('export xlsx and pdf', async () => {
    const x = await get('abm', id.bm, 'export', { format: 'xlsx' })
      .buffer(true)
      .parse((res, cb) => {
        const c: Buffer[] = [];
        res.on('data', (b: Buffer) => c.push(b));
        res.on('end', () => cb(null, Buffer.concat(c)));
      });
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    expect(x.headers['cache-control']).toBe('no-store');
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const p = await get('abm', id.bm, 'export', { format: 'pdf', granularity: 'week' })
      .buffer(true)
      .parse((res, cb) => {
        const c: Buffer[] = [];
        res.on('data', (b: Buffer) => c.push(b));
        res.on('end', () => cb(null, Buffer.concat(c)));
      });
    expect(p.status).toBe(200);
    expect(p.headers['content-type']).toContain('application/pdf');
    expect((p.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect((await get('abm', id.bm2, 'export', { format: 'pdf' })).status).toBe(404);
    expect((await get('bm', id.bm2, 'export', { format: 'pdf' })).status).toBe(403);
    expect((await get('abm', id.bm, 'export', { format: 'csv' })).status).toBe(422);
  });
});
