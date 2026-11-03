import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clientIp, ipRateKey } from '../src/common/client-ip';
import { MemoryRateLimitStore, rateLimitStore } from '../src/common/rate-limit';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const req = (remote: string, headers: Record<string, string> = {}) =>
  ({ headers, socket: { remoteAddress: remote } }) as unknown as IncomingMessage;

describe('clientIp (#77)', () => {
  afterEach(() => {
    delete process.env.CLIENT_IP_MODE;
  });
  it('socket mode ignores X-Forwarded-For and CF-Connecting-IP', () => {
    const r = req('::ffff:10.0.0.5', {
      'x-forwarded-for': '1.2.3.4',
      'cf-connecting-ip': '5.6.7.8',
    });
    expect(clientIp(r)).toBe('10.0.0.5');
  });
  it('cloudflare mode uses CF-Connecting-IP, never X-Forwarded-For', () => {
    process.env.CLIENT_IP_MODE = 'cloudflare';
    expect(clientIp(req('10.0.0.5', { 'cf-connecting-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(req('10.0.0.5', { 'x-forwarded-for': '1.2.3.4' }))).toBe('10.0.0.5');
    expect(clientIp(req('10.0.0.5', { 'cf-connecting-ip': 'not-an-ip' }))).toBe('10.0.0.5');
  });
  it('railway mode uses only a valid X-Real-IP supplied by the Railway edge', () => {
    process.env.CLIENT_IP_MODE = 'railway';
    expect(
      clientIp(
        req('10.0.0.5', {
          'x-real-ip': '203.0.113.9',
          'cf-connecting-ip': '198.51.100.1',
          'x-forwarded-for': '192.0.2.1',
        }),
      ),
    ).toBe('203.0.113.9');
    expect(clientIp(req('10.0.0.5', { 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(clientIp(req('10.0.0.5', { 'x-real-ip': '203.0.113.9, 192.0.2.1' }))).toBe('10.0.0.5');
    expect(clientIp(req('10.0.0.5', { 'cf-connecting-ip': '203.0.113.9' }))).toBe('10.0.0.5');
  });
});

describe('ipRateKey', () => {
  it('keeps IPv4, buckets IPv6 by /64, ? when unknown', () => {
    expect(ipRateKey('203.0.113.9')).toBe('203.0.113.9');
    expect(ipRateKey('2001:db8:0:1::5')).toBe('2001:db8:0:1::/64');
    expect(ipRateKey('2001:0db8:0000:0001:ffff:1:2:3')).toBe('2001:db8:0:1::/64');
    expect(ipRateKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipRateKey('::1')).toBe('0:0:0:0::/64');
    expect(ipRateKey(null)).toBe('?');
  });
});

describe('MemoryRateLimitStore', () => {
  it('fixed window with retryAfter', async () => {
    const s = new MemoryRateLimitStore();
    expect((await s.hit('k', 2, 60_000)).allowed).toBe(true);
    expect((await s.hit('k', 2, 60_000)).allowed).toBe(true);
    const third = await s.hit('k', 2, 60_000);
    expect(third.allowed).toBe(false);
    expect(third.retryAfter).toBeGreaterThan(0);
    expect(third.retryAfter).toBeLessThanOrEqual(60);
    expect((await s.hit('other', 2, 60_000)).allowed).toBe(true);
  });
});

// HTTP: public endpoints share the limiter; XFF spoofing does not reset the count. No DB needed for
// sign-in attempts with an unknown email (better-auth answers 401 before any session).
describe.skipIf(!process.env.DATABASE_URL)('rate limits over HTTP', () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.AUTH_RATE_PER_IP = '3';
    process.env.INVITE_RATE_PER_IP = '2';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
  });
  afterAll(async () => {
    delete process.env.AUTH_RATE_PER_IP;
    delete process.env.INVITE_RATE_PER_IP;
    await rateLimitStore().reset();
    await app?.close();
  });

  it('sign-in: 429 + Retry-After + envelope; spoofed X-Forwarded-For does not help', async () => {
    await rateLimitStore().reset();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await request(app.getHttpServer())
        .post('/v1/auth/sign-in/email')
        .set('x-forwarded-for', `198.51.100.${i}`)
        .send({ email: `nobody${i}@example.com`, password: 'wrong-password-x' });
      codes.push(r.status);
      if (r.status === 429) {
        expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
        expect(r.body.error.code).toBe('RATE_LIMITED');
        expect(r.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
      }
    }
    expect(codes.slice(0, 3).every((c) => c !== 429)).toBe(true);
    expect(codes.slice(3)).toEqual([429, 429]);
  });

  it('invite accept is limited the same way (Nest route, Retry-After header)', async () => {
    await rateLimitStore().reset();
    const send = () =>
      request(app.getHttpServer())
        .post('/v1/invites/accept')
        .set('x-forwarded-for', '192.0.2.1')
        .send({ token: 'x'.repeat(43), password: 'long-enough-pw' });
    expect((await send()).status).not.toBe(429);
    expect((await send()).status).not.toBe(429);
    const r = await send();
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
    expect(r.body.error.code).toBe('RATE_LIMITED');
  });
});
