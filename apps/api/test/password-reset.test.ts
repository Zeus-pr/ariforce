import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PASSWORD_RESET_ERROR_CODES as CODES } from '@ariforce/contracts';
import { T, U } from '@ariforce/db';
import { bearerFor, insertRetiredHolder, insertStaff } from './support';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { rateLimitStore } from '../src/common/rate-limit';
import { TeamService } from '../src/team/team.service';
import { MAIL_SENDER, type MailMessage, type MailSender } from '../src/mail/mail.service';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);
const NEW_PW = 'A-brand-new-password-1';

/** Captures mail instead of sending it (nothing leaves the test). */
class FakeSender implements MailSender {
  sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
  }
}

/** Item F: forgot password with an emailed 6-digit code (docs/AUTH-PASSWORD-RESET.md). */
describe.skipIf(!OWNER || !APP)('forgot password / reset (real API, mocked mail)', () => {
  let app: INestApplication;
  let pool: Pool;
  const mail = new FakeSender();
  const http = () => request(app.getHttpServer());
  const forgot = (email: string) => http().post('/v1/auth/password/forgot').send({ email });
  const reset = (email: string, code: string, password = NEW_PW) =>
    http().post('/v1/auth/password/reset').send({ email, code, password });
  const tick = () => new Promise((r) => setTimeout(r, 50));
  const codeFor = async (email: string) => {
    await tick();
    const m = [...mail.sent].reverse().find((x) => x.to === email && x.kind === 'password_reset');
    return m?.text.match(/\b(\d{6})\b/)?.[1];
  };
  const audits = async (action: string, email: string) =>
    Number(
      (
        await pool.query(
          `select count(*) from audit_log a join auth_user u on u.id::text = a.entity_id
           where a.action = $1 and u.email = $2`,
          [action, email],
        )
      ).rows[0].count,
    );

  beforeAll(async () => {
    process.env.PASSWORD_RESET_RATE_PER_IP = '1000';
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_SENDER)
      .useValue(mail)
      .compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    pool = new Pool({ connectionString: OWNER, max: 1 });
  });
  beforeEach(() => {
    mail.sent = [];
  });
  afterAll(async () => {
    delete process.env.PASSWORD_RESET_RATE_PER_IP;
    await rateLimitStore().reset();
    await pool?.end();
    await app?.close();
  });

  it('happy path: code mailed, reset revokes sessions, new password signs in, audited', async () => {
    const email = `pw.${RUN}.ok@example.test`;
    const s = await insertStaff(email, 'business_manager', null);
    expect((await http().get('/v1/me').set('authorization', s.bearer)).status).toBe(200);
    const f = await forgot(email);
    expect(f.status).toBe(200);
    expect(f.body).toMatchObject({ ok: true });
    const code = await codeFor(email);
    expect(code).toMatch(/^\d{6}$/);
    expect(mail.sent.find((m) => m.to === email)!.subject).not.toContain(code!);
    const r = await reset(email, code!);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect((await http().get('/v1/me').set('authorization', s.bearer)).status).toBe(401);
    const si = await http().post('/v1/auth/sign-in/email').send({ email, password: NEW_PW });
    expect(si.status).toBe(200);
    // The code is single-use.
    expect((await reset(email, code!)).body.error.code).toBe(CODES.invalid);
    expect(await audits('auth.password_reset_requested', email)).toBe(1);
    expect(await audits('auth.password_reset_completed', email)).toBe(1);
  });

  it('generic answer: unknown, suspended and never-signed-in emails get the same reply and no mail', async () => {
    const known = `pw.${RUN}.gen@example.test`;
    await insertStaff(known, 'business_manager', null);
    const susp = `pw.${RUN}.susp@example.test`;
    const s = await insertStaff(susp, 'business_manager', null);
    await pool.query(`update users set status = 'suspended' where id = $1`, [s.id]);
    const invited = `pw.${RUN}.inv@example.test`;
    await insertRetiredHolder(invited, 'accountant');
    const a = await forgot(known);
    const bodies = [];
    for (const e of [`pw.${RUN}.nobody@example.test`, susp, invited]) {
      const r = await forgot(e);
      expect(r.status).toBe(200);
      bodies.push(r.body);
    }
    for (const b of bodies) expect(b).toEqual(a.body);
    await tick();
    expect(mail.sent.map((m) => m.to)).toEqual([known]);
    // Ineligible accounts cannot reset either (same error as a wrong code).
    expect((await reset(susp, '123456')).body.error.code).toBe(CODES.invalid);
    expect(await audits('auth.password_reset_requested', susp)).toBe(0);
  });

  it('3 wrong codes 400 each; then 403 even with the right code (code burnt)', async () => {
    const email = `pw.${RUN}.tries@example.test`;
    await insertStaff(email, 'business_manager', null);
    await forgot(email);
    const code = (await codeFor(email))!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) {
      const r = await reset(email, wrong);
      expect([r.status, r.body.error.code]).toEqual([400, CODES.invalid]);
    }
    const r4 = await reset(email, code);
    expect([r4.status, r4.body.error.code]).toEqual([403, CODES.tooMany]);
    // A new code works again.
    await forgot(email);
    expect((await reset(email, (await codeFor(email))!)).status).toBe(200);
  });

  it('expired code 400 PASSWORD_RESET_CODE_EXPIRED', async () => {
    const email = `pw.${RUN}.exp@example.test`;
    await insertStaff(email, 'business_manager', null);
    await forgot(email);
    const code = (await codeFor(email))!;
    await pool.query(
      `update auth_verification set expires_at = now() - interval '1 minute' where identifier like $1`,
      [`%${email}%`],
    );
    const r = await reset(email, code);
    expect([r.status, r.body.error.code]).toEqual([400, CODES.expired]);
  });

  it('password rule (min 12) and code format are validated (422)', async () => {
    const email = `pw.${RUN}.val@example.test`;
    expect((await reset(email, '123456', 'short-pass')).status).toBe(422);
    expect((await reset(email, '12345')).status).toBe(422);
    expect((await forgot('not-an-email')).status).toBe(422);
  });

  it('per-email limit: 3 per hour, then 429 with Retry-After', async () => {
    const email = `pw.${RUN}.rl@example.test`;
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await forgot(email)).status);
    expect(codes).toEqual([200, 200, 200, 429]);
    const r = await forgot(email);
    expect(r.headers['retry-after']).toBeDefined();
  });

  it("better-auth's own reset / OTP routes are not reachable (404)", async () => {
    for (const p of [
      '/v1/auth/email-otp/send-verification-otp',
      '/v1/auth/email-otp/request-password-reset',
      '/v1/auth/email-otp/reset-password',
      '/v1/auth/forget-password/email-otp',
      '/v1/auth/request-password-reset',
      '/v1/auth/reset-password',
      '/v1/auth/sign-in/email-otp',
    ])
      expect((await http().post(p).send({ email: 'x@example.test' })).status, p).toBe(404);
  });

  it('an invite sends the set-password link to the invitee (link never logged)', async () => {
    const admin = await bearerFor(
      http,
      'sysadmin',
      process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass',
    );
    const email = `pw.${RUN}.invitee@example.test`;
    const r = await http()
      .post('/v1/employees')
      .set('authorization', admin)
      .send({
        name: `Invitee ${RUN}`,
        email,
        role: 'business_manager',
        territoryIds: [T.hq],
        managerId: U.area,
      });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    await tick();
    const m = mail.sent.find((x) => x.to === email && x.kind === 'invite');
    expect(m?.text).toMatch(/\/invite\?token=[\w%-]+/);
    expect(m?.text).toContain(`Invitee ${RUN}`);
  });

  it('an invite whose transaction rolls back sends no email', async () => {
    const admin = await bearerFor(
      http,
      'sysadmin',
      process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass',
    );
    const email = `pw.${RUN}.rollback@example.test`;
    // Fail create() after the invite row is written, inside the same transaction.
    const team = app.get(TeamService) as unknown as { nodes: () => Promise<unknown> };
    const spy = vi.spyOn(team, 'nodes').mockRejectedValueOnce(new Error('boom'));
    try {
      const r = await http()
        .post('/v1/employees')
        .set('authorization', admin)
        .send({
          name: `Rollback ${RUN}`,
          email,
          role: 'business_manager',
          territoryIds: [T.hq],
          managerId: U.area,
        });
      expect(r.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    await tick();
    expect(mail.sent.filter((x) => x.to === email)).toEqual([]);
    const left = await pool.query('select 1 from users where email = $1', [email]);
    expect(left.rowCount).toBe(0);
  });
});
