import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import {
  authCookieOptions,
  isMobileAuthClient,
  mobileSessionMaxAgeSeconds,
  sessionMaxAgeSeconds,
} from '../src/auth/auth';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;

describe('session config', () => {
  it('web 18 h hard cap by default, env override within bounds', () => {
    expect(sessionMaxAgeSeconds({})).toBe(64800);
    expect(sessionMaxAgeSeconds({ SESSION_MAX_AGE_SECONDS: '3600' })).toBe(3600);
    expect(sessionMaxAgeSeconds({ SESSION_MAX_AGE_SECONDS: '10' })).toBe(64800);
    expect(sessionMaxAgeSeconds({ SESSION_MAX_AGE_SECONDS: 'x' })).toBe(64800);
  });
  it('mobile 90 d hard cap by default, env override within bounds', () => {
    expect(mobileSessionMaxAgeSeconds({})).toBe(90 * 24 * 60 * 60);
    expect(mobileSessionMaxAgeSeconds({ MOBILE_SESSION_MAX_AGE_SECONDS: '86400' })).toBe(86400);
    expect(mobileSessionMaxAgeSeconds({ MOBILE_SESSION_MAX_AGE_SECONDS: '10' })).toBe(
      90 * 24 * 60 * 60,
    );
  });
  it('detects mobile via header or Expo/okhttp user-agent', () => {
    expect(isMobileAuthClient('Mozilla/5.0', null)).toBe(false);
    expect(isMobileAuthClient('Mozilla/5.0', 'mobile')).toBe(true);
    expect(isMobileAuthClient('Expo/58.0.0', null)).toBe(true);
    expect(isMobileAuthClient('okhttp/4.12.0', null)).toBe(true);
  });
  it('cookie: HttpOnly, Path=/, Lax default; None forces Secure; optional parent domain', () => {
    expect(authCookieOptions({}).defaultCookieAttributes).toEqual({
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
    });
    expect(
      authCookieOptions({ AUTH_COOKIE_SAMESITE: 'none' }).defaultCookieAttributes,
    ).toMatchObject({ sameSite: 'none', secure: true });
    expect(authCookieOptions({ AUTH_COOKIE_DOMAIN: 'x.com' })).toMatchObject({
      crossSubDomainCookies: { enabled: true, domain: 'x.com' },
    });
  });
});

// Runs in CI: .github/workflows sets DIRECT_URL/DATABASE_URL at workflow level with a postgres service,
// migrates + seeds, then `pnpm test`. Locally it skips unless both URLs point at a test DB.
describe.skipIf(!OWNER || !APP)('expired session (real API)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  const dom = `s${Date.now()}.local`;
  const pw = `t-${Math.random().toString(36).slice(2)}-Aa1!`;
  beforeAll(async () => {
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        resolve(process.cwd(), 'scripts/admin-create-first.mts'),
        '--company',
        'demo',
        '--email',
        `admin@${dom}`,
      ],
      { env: { ...process.env, ARIFORCE_ADMIN_PASSWORD: pw }, encoding: 'utf8' },
    );
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('cookie Max-Age = web cap; after expiry /v1/me and data routes answer 401', async () => {
    const res = await http()
      .post('/v1/auth/sign-in/email')
      .send({ email: `admin@${dom}`, password: pw });
    expect(res.status).toBe(200);
    const token = String(res.headers['set-auth-token']);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
    expect(cookie).toMatch(/session_token=.*Max-Age=64800/i);
    expect(cookie).toMatch(/HttpOnly/i);
    const bearer = `Bearer ${token}`;
    expect((await http().get('/v1/me').set('Authorization', bearer)).status).toBe(200);

    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: OWNER, max: 1 });
    try {
      await pool.query(
        `update auth_session set expires_at = now() - interval '1 second' where token = $1`,
        [token.split('.')[0]],
      );
    } finally {
      await pool.end();
    }
    for (const path of ['/v1/me', '/v1/dcrs?from=2026-11-01&to=2026-11-03'])
      expect((await http().get(path).set('Authorization', bearer)).status).toBe(401);
  });

  it('mobile client header gets a ~90 day session row (web cookie Max-Age stays 18 h)', async () => {
    const res = await http()
      .post('/v1/auth/sign-in/email')
      .set('x-ariforce-client', 'mobile')
      .send({ email: `admin@${dom}`, password: pw });
    expect(res.status).toBe(200);
    const token = String(res.headers['set-auth-token']);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
    expect(cookie).toMatch(/session_token=.*Max-Age=64800/i);

    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: OWNER, max: 1 });
    try {
      const { rows } = await pool.query<{ days: string }>(
        `select extract(epoch from (expires_at - created_at))/86400 as days
         from auth_session where token = $1`,
        [token.split('.')[0]],
      );
      expect(Number(rows[0]?.days)).toBeGreaterThan(80);
      expect(Number(rows[0]?.days)).toBeLessThan(100);
    } finally {
      await pool.end();
    }
  });
});
