import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
// Writes users: only against the throwaway local/CI database (requires the owner URL to be set too).
describe.skipIf(!OWNER || !APP)('admin:create-first', () => {
  let app: INestApplication;
  const dom = `t${Date.now()}.local`;
  const pw = `t-${Math.random().toString(36).slice(2)}-Aa1!`;
  const run = (...args: string[]) =>
    execFileSync(
      process.execPath,
      ['--import', 'tsx', resolve(process.cwd(), 'scripts/admin-create-first.mts'), ...args],
      {
        env: { ...process.env, ARIFORCE_ADMIN_PASSWORD: pw, ARIFORCE_DEMO_PASSWORD: pw },
        encoding: 'utf8',
      },
    );
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
  });
  afterAll(async () => app?.close());

  it('creates a system admin + demo chain, idempotently, without printing the password', async () => {
    const out = run(
      '--company',
      'demo',
      '--email',
      `first-admin@${dom}`,
      '--demo-users',
      '--demo-domain',
      dom,
    );
    expect(out).toContain('created system_admin');
    expect(out).not.toContain(pw);
    expect(run('--company', 'demo', '--email', `first-admin@${dom}`)).toContain('exists');
    const s = await request(app.getHttpServer())
      .post('/v1/auth/sign-in/email')
      .send({ email: `first-admin@${dom}`, password: pw });
    expect(s.status).toBe(200);
    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${s.headers['set-auth-token']}`);
    expect(me.body.roles).toEqual(['system_admin']);
    const bm = await request(app.getHttpServer())
      .post('/v1/auth/sign-in/email')
      .send({ email: `bm@${dom}`, password: pw });
    const bmMe = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${bm.headers['set-auth-token']}`);
    expect(bmMe.body.roles).toEqual(['business_manager']);
    expect(bmMe.body.managerId).toBeTruthy();
  });
});
