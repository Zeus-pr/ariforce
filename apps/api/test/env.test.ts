import { describe, expect, it } from 'vitest';
import { envProblems, validateEnv } from '../src/env';

// Fake values only (never real secrets).
const good = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://u:fake-pass-value@db.example:6543/ariforce',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  BETTER_AUTH_URL: 'https://api.example.com',
  WEB_ORIGIN: 'https://app.example.com,https://admin.example.com',
  TRUST_PROXY: 'loopback',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'fake-access-key',
  R2_SECRET_ACCESS_KEY: 'fake-secret-value-123',
  R2_BUCKET: 'bucket',
  RESEND_API_KEY: 're_fakefakefake123',
  MAIL_FROM: 'AriForce <no-reply@mail.example.com>',
};

describe('env validation (#80)', () => {
  it('dev and test are lenient', () => {
    expect(envProblems({ NODE_ENV: 'development' })).toEqual([]);
    expect(envProblems({ NODE_ENV: 'test' })).toEqual([]);
    expect(envProblems({})).toEqual([]);
  });
  it('a complete production env passes', () => {
    expect(envProblems(good)).toEqual([]);
    expect(() => validateEnv(good)).not.toThrow();
  });
  it('missing variables are listed by name', () => {
    const p = envProblems({ NODE_ENV: 'production' });
    for (const n of [
      'DATABASE_URL',
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
      'WEB_ORIGIN',
      'TRUST_PROXY',
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET',
      'RESEND_API_KEY',
      'MAIL_FROM',
    ])
      expect(p).toContain(`${n}: is required`);
    expect(envProblems({ ...good, R2_BUCKET: '' })).toEqual(['R2_BUCKET: is required']);
  });
  it('invalid values are rejected without echoing them', () => {
    const bad = {
      ...good,
      BETTER_AUTH_SECRET: 'short-secret-zzz',
      BETTER_AUTH_URL: 'http://api.example.com',
      WEB_ORIGIN: 'https://app.example.com/path,*',
      DATABASE_URL: 'mysql://fake-pass-value@x',
      R2_ENDPOINT: 'not a url',
      PORT: 'abc',
      INVITE_RETURN_LINK: 'true',
    };
    const p = envProblems(bad);
    expect(p.map((l) => l.split(':')[0]).sort()).toEqual(
      [
        'BETTER_AUTH_SECRET',
        'BETTER_AUTH_URL',
        'DATABASE_URL',
        'INVITE_RETURN_LINK',
        'PORT',
        'R2_ENDPOINT',
        'WEB_ORIGIN',
      ].sort(),
    );
    let msg = '';
    try {
      validateEnv(bad);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('BETTER_AUTH_SECRET');
    for (const v of [
      'short-secret-zzz',
      'fake-pass-value',
      'fake-secret-value-123',
      'app.example.com',
    ])
      expect(msg).not.toContain(v);
  });
  it('mail settings (item F) are checked without echoing values', () => {
    const p = envProblems({
      ...good,
      RESEND_API_KEY: 'not-a-key',
      MAIL_FROM: 'AriForce <no-reply@localhost>',
      PASSWORD_RESET_RATE_PER_EMAIL: 'x',
    });
    expect([...new Set(p.map((l) => l.split(':')[0]))].sort()).toEqual([
      'MAIL_FROM',
      'PASSWORD_RESET_RATE_PER_EMAIL',
      'RESEND_API_KEY',
    ]);
    expect(p.join('\n')).not.toContain('not-a-key');
    expect(envProblems({ ...good, MAIL_FROM: 'no-reply@mail.example.com' })).toEqual([]);
  });
});
