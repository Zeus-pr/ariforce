import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';

describe.skipIf(!OWNER || !APP)('GET /v1/territories/compact (real API)', () => {
  let app: INestApplication;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    for (const who of ['bm', 'director']) {
      const res = await http()
        .post('/v1/auth/sign-in/email')
        .send({ email: `${who}@demo.ariforce.in`, password: PASSWORD });
      tok[who] = `Bearer ${res.headers['set-auth-token']}`;
    }
  });
  afterAll(async () => app?.close());

  const fullIds = async (who: string) => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const r: request.Response = await http()
        .get(`/v1/territories?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
        .set(as(who));
      expect(r.status).toBe(200);
      ids.push(...r.body.items.map((t: { id: string }) => t.id));
      cursor = r.body.nextCursor;
    } while (cursor);
    return ids.sort();
  };

  it('returns the same territories as the full list per caller, compact shape, ETag/304', async () => {
    for (const who of ['bm', 'director']) {
      const r = await http().get('/v1/territories/compact').set(as(who));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.headers['cache-control']).toBe('private, max-age=60');
      expect(r.headers.etag).toMatch(/^W\/"tc-/);
      expect(r.body.nextCursor).toBeNull();
      for (const t of r.body.items)
        expect(Object.keys(t).sort()).toEqual(['id', 'level', 'name', 'parentId']);
      expect(r.body.items.map((t: { id: string }) => t.id).sort()).toEqual(await fullIds(who));
      const again = await http()
        .get('/v1/territories/compact')
        .set(as(who))
        .set('If-None-Match', r.headers.etag!);
      expect(again.status).toBe(304);
    }
    // BM's subtree is smaller than the director's (scope applies).
    const bm = (await http().get('/v1/territories/compact').set(as('bm'))).body.items.length;
    const dir = (await http().get('/v1/territories/compact').set(as('director'))).body.items.length;
    expect(bm).toBeLessThan(dir);
  });

  it('pages, filters and validates', async () => {
    const one = await http().get('/v1/territories/compact?limit=1').set(as('director'));
    expect(one.body.items).toHaveLength(1);
    expect(one.body.nextCursor).toBeTruthy();
    const hq = await http().get('/v1/territories/compact?level=headquarter').set(as('director'));
    expect(hq.body.items.every((t: { level: string }) => t.level === 'headquarter')).toBe(true);
    expect(
      (await http().get('/v1/territories/compact?limit=5000').set(as('director'))).status,
    ).toBe(422);
    expect((await http().get('/v1/territories/compact')).status).toBe(401);
  });
});
