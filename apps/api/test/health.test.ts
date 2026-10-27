import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WORK_TYPES } from '@ariforce/db';
import { WorkTypesCheck } from '../src/health/work-types.check';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('health', () => {
  it('GET /v1/health', async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    const res = await request(app.getHttpServer()).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(Array.isArray(res.body.warnings)).toBe(true);
    await app.close();
  });
});

describe('openapi', () => {
  it('serves /openapi.json and /docs', async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    const res = await request(app.getHttpServer()).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    const docs = await request(app.getHttpServer()).get('/docs');
    expect(docs.status).toBe(200);
    await app.close();
  });
});

describe.skipIf(!process.env.DIRECT_URL || !process.env.DATABASE_URL)(
  'health: work types warning',
  () => {
    it('warns for a company with no work types, not otherwise, and stays ok', async () => {
      const owner = new Pool({ connectionString: process.env.DIRECT_URL });
      const id = randomUUID();
      const slug = `wt-health-${Date.now().toString(36)}`;
      await owner.query(`insert into companies (id, name, slug) values ($1, 'WT health', $2)`, [
        id,
        slug,
      ]);
      const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const app = configureApp(mod.createNestApplication({ bodyParser: false }));
      await app.init();
      try {
        const a = await request(app.getHttpServer()).get('/v1/health');
        expect(a.status).toBe(200);
        expect(a.body.status).toBe('ok');
        expect(a.body.warnings).toContainEqual({
          code: 'NO_WORK_TYPES',
          companyId: id,
          companySlug: slug,
          message: 'Company has no active work types',
        });
        expect(a.body.warnings.map((w: { companySlug: string }) => w.companySlug)).not.toContain(
          'demo',
        );
        for (const w of DEFAULT_WORK_TYPES)
          await owner.query(
            `insert into work_types (id, company_id, code, name, kind, counts_as_field_day, allowance_band, requires_location)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              randomUUID(),
              id,
              w.code,
              w.name,
              w.kind,
              w.countsAsFieldDay,
              w.allowanceBand,
              w.requiresLocation,
            ],
          );
        await app.get(WorkTypesCheck).warnings(true); // skip the 60 s cache
        const b = await request(app.getHttpServer()).get('/v1/health');
        expect(b.body.status).toBe('ok');
        expect(b.body.warnings.map((w: { companyId: string }) => w.companyId)).not.toContain(id);
      } finally {
        await app.close();
        await owner.query(`update companies set deleted_at = now() where id = $1`, [id]);
        await owner.end();
      }
    });
  },
);
