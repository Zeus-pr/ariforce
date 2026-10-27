import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearerFor } from './support';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const WRITERS = ['rbm', 'zbm', 'sm', 'gm', 'vp', 'director', 'sysadmin'];
const READ_ONLY = ['abm', 'bm'];
const NO_MASTERS = ['dh', 'accountant'];

describe.skipIf(!OWNER || !APP)('Masters permissions per role tier (real API)', () => {
  let app: INestApplication;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    for (const who of [...WRITERS, ...READ_ONLY, ...NO_MASTERS]) {
      tok[who] = await bearerFor(http, who, PASSWORD);
    }
  });
  afterAll(async () => {
    await app?.close();
  });

  const probes = (who: string) => {
    const a = { authorization: tok[who]! };
    return Promise.all([
      http().post('/v1/work-types').set(a).send({}),
      http().patch('/v1/doctors/00000000-0000-0000-0000-000000000000').set(a).send({}),
      http().delete('/v1/chemists/00000000-0000-0000-0000-000000000000').set(a),
      http().post('/v1/doctors/import').set(a).send({ dryRun: true, rows: [] }),
      http().post('/v1/territories/import').set(a).send({ dryRun: true, rows: [] }),
      http().get('/v1/imports/00000000-0000-0000-0000-000000000000').set(a),
    ]);
  };

  it.each(WRITERS)('%s can write masters (no 403)', async (who) => {
    for (const r of await probes(who))
      expect(r.status, `${who} ${(r as unknown as { req: { path: string } }).req.path}`).not.toBe(
        403,
      );
  });
  it.each([...READ_ONLY, ...NO_MASTERS])('%s gets 403 on every masters write', async (who) => {
    for (const r of await probes(who))
      expect(r.status, `${who} ${(r as unknown as { req: { path: string } }).req.path}`).toBe(403);
  });
  it.each(READ_ONLY)('%s can still read masters', async (who) => {
    const r = await http().get('/v1/doctors?limit=1').set({ authorization: tok[who]! });
    expect(r.status).toBe(200);
  });
  it.each(NO_MASTERS)('%s cannot read doctors or chemists', async (who) => {
    for (const path of ['/v1/doctors?limit=1', '/v1/chemists?limit=1']) {
      const r = await http().get(path).set({ authorization: tok[who]! });
      expect(r.status, `${who} ${path}`).toBe(403);
    }
  });
  it('distribution_head reads stockists, products, divisions, territories (company-wide)', async () => {
    for (const path of ['/v1/stockists', '/v1/products', '/v1/divisions', '/v1/territories']) {
      const r = await http()
        .get(`${path}?limit=1&includeTotal=true`)
        .set({ authorization: tok.dh! });
      expect(r.status, path).toBe(200);
    }
  });
  it('accountant reads products, divisions, territories but not stockists', async () => {
    for (const path of ['/v1/products', '/v1/divisions', '/v1/territories']) {
      const r = await http().get(`${path}?limit=1`).set({ authorization: tok.accountant! });
      expect(r.status, path).toBe(200);
    }
    const s = await http().get('/v1/stockists?limit=1').set({ authorization: tok.accountant! });
    expect(s.status).toBe(403);
  });
});
