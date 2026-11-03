import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertStaff } from './support';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { configureApp } from '../src/bootstrap';
import { rateLimitStore } from '../src/common/rate-limit';
import { MAIL_SENDER, type MailMessage, type MailSender } from '../src/mail/mail.service';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-1';

class FakeSender implements MailSender {
  sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
  }
}

/** Emailed sign-in code after the password (docs/AUTH-LOGIN-OTP.md). */
describe.skipIf(!OWNER || !APP)('sign-in OTP (real API, mocked mail)', () => {
  let app: INestApplication;
  let pool: Pool;
  const mail = new FakeSender();
  const http = () => request(app.getHttpServer());
  const tick = () => new Promise((r) => setTimeout(r, 80));
  const cookies = (res: request.Response) =>
    ((res.headers['set-cookie'] ?? []) as unknown as string[]).map((c) => c.split(';')[0]!).join('; ');
  const codeFor = async (email: string) => {
    await tick();
    const m = [...mail.sent].reverse().find((x) => x.to === email && x.kind === 'login_code');
    return m?.text.match(/\b(\d{6})\b/)?.[1];
  };
  const audits = async (action: string, email: string) =>
    Number(
      (
        await pool.query(
          `select count(*) from audit_log a join users u on u.id = a.actor_user_id
           where a.action = $1 and u.email = $2`,
          [action, email],
        )
      ).rows[0].count,
    );
  const newUser = async (tag: string) => {
    const email = `otp.${RUN}.${tag}@example.test`;
    const s = await insertStaff(email, 'business_manager', null);
    const ctx = await app.get(AuthService).auth.$context;
    const hash = await ctx.password.hash(PASSWORD);
    await pool.query(
      `insert into auth_account (id, account_id, provider_id, user_id, password)
       select $1, u.id, 'credential', u.id, $2 from auth_user u where u.email = $3`,
      [randomUUID(), hash, email],
    );
    return { email, bearer: s.bearer };
  };
  const signIn = (email: string, password = PASSWORD) =>
    http().post('/v1/auth/sign-in/email').send({ email, password });
  const sendOtp = (c: string) => http().post('/v1/auth/two-factor/send-otp').set('cookie', c).send({});
  const verify = (c: string, code: string) =>
    http().post('/v1/auth/two-factor/verify-otp').set('cookie', c).send({ code });

  beforeAll(async () => {
    process.env.LOGIN_OTP = 'on';
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_SENDER)
      .useValue(mail)
      .compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    pool = new Pool({ connectionString: OWNER, max: 1 });
  });
  beforeEach(async () => {
    mail.sent = [];
    await rateLimitStore().reset();
  });
  afterAll(async () => {
    delete process.env.LOGIN_OTP;
    await rateLimitStore().reset();
    await pool?.end();
    await app?.close();
  });

  it('password alone gives no session; the emailed code completes sign-in, audited once', async () => {
    const { email } = await newUser('ok');
    const r = await signIn(email);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ twoFactorRedirect: true });
    // The bearer plugin still echoes a token for the transient session; it must already be dead.
    const stale = r.headers['set-auth-token'] as string | undefined;
    if (stale)
      expect((await http().get('/v1/me').set('authorization', `Bearer ${stale}`)).status).toBe(401);
    expect(await audits('auth.session_revoked', email)).toBe(0);
    const c = cookies(r);
    expect(c).toContain('two_factor');

    expect((await sendOtp(c)).status).toBe(200);
    const code = await codeFor(email);
    expect(code).toMatch(/^\d{6}$/);
    expect(mail.sent.find((m) => m.kind === 'login_code')!.subject).not.toContain(code!);

    const v = await verify(c, code!);
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    const token = v.headers['set-auth-token'] as string;
    expect(token).toBeTruthy();
    expect((await http().get('/v1/me').set('authorization', `Bearer ${token}`)).status).toBe(200);
    expect(await audits('auth.sign_in', email)).toBe(1);

    // Single use.
    expect((await verify(c, code!)).status).toBeGreaterThanOrEqual(400);
  });

  it('wrong password sends no code', async () => {
    const { email } = await newUser('badpw');
    const r = await signIn(email, 'not-the-password-1');
    expect(r.status).toBe(401);
    await tick();
    expect(mail.sent.filter((m) => m.kind === 'login_code')).toHaveLength(0);
  });

  it('wrong code is refused; three wrong tries lock out even the right code', async () => {
    const { email } = await newUser('wrong');
    const c = cookies(await signIn(email));
    await sendOtp(c);
    const code = (await codeFor(email))!;
    const bad = code === '000000' ? '111111' : '000000';
    expect((await verify(c, bad)).status).toBeGreaterThanOrEqual(400);
    expect((await verify(c, bad)).status).toBeGreaterThanOrEqual(400);
    expect((await verify(c, bad)).status).toBeGreaterThanOrEqual(400);
    const after = await verify(c, code);
    expect(after.status).toBeGreaterThanOrEqual(400);
    expect(after.headers['set-auth-token']).toBeUndefined();
  });

  it('a code cannot be verified without the password step (no challenge cookie)', async () => {
    const { email } = await newUser('nocookie');
    const v = await http().post('/v1/auth/two-factor/verify-otp').send({ code: '123456' });
    expect(v.status).toBeGreaterThanOrEqual(400);
    expect(v.headers['set-auth-token']).toBeUndefined();
    expect(email).toBeTruthy();
  });

  it('authenticator and backup-code routes are not exposed', async () => {
    for (const p of ['enable', 'disable', 'verify-totp', 'verify-backup-code', 'generate-backup-codes']) {
      const r = await http().post(`/v1/auth/two-factor/${p}`).send({});
      expect(r.status, p).toBe(404);
    }
  });
});
