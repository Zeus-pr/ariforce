import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const saved = {
  NODE_ENV: process.env.NODE_ENV,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
};

async function makeApp(env: Partial<typeof saved>) {
  Object.assign(process.env, env);
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(mod.createNestApplication({ bodyParser: false }));
  await app.init();
  return app;
}

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('security headers (#81)', () => {
  it('sets strict JSON-API headers and no x-powered-by', async () => {
    const app = await makeApp({ NODE_ENV: 'test' });
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeUndefined();
    await app.close();
  });

  it('keeps CORS strict: only configured origins are reflected', async () => {
    const app = await makeApp({ NODE_ENV: 'test', WEB_ORIGIN: 'https://app.example.test' });
    const ok = await request(app.getHttpServer())
      .options('/v1/me')
      .set('Origin', 'https://app.example.test')
      .set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.example.test');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://evil.example.test');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('serves /docs and /openapi.json outside production', async () => {
    const app = await makeApp({ NODE_ENV: 'development' });
    expect((await request(app.getHttpServer()).get('/openapi.json')).status).toBe(200);
    const docs = await request(app.getHttpServer()).get('/docs');
    expect(docs.status).toBe(200);
    expect(docs.headers['content-security-policy']).toBeUndefined();
    await app.close();
  });

  it('hides /docs and /openapi.json in production and enables HSTS', async () => {
    const app = await makeApp({
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'test-only-not-a-secret-0123456789abcdef',
    });
    const spec = await request(app.getHttpServer()).get('/openapi.json');
    expect(spec.status).toBe(404);
    expect(spec.body.openapi).toBeUndefined();
    expect((await request(app.getHttpServer()).get('/docs')).status).toBe(404);
    const h = await request(app.getHttpServer()).get('/health');
    expect(h.headers['strict-transport-security']).toContain('max-age=31536000');
    await app.close();
  });
});
