import { describe, expect, it } from 'vitest';
import { InviteAccept, PasswordReset, SignupRequestCreate } from '../src';
import { passwordAccepted, passwordChecks, passwordRuleMessage } from '../src/schemas/password';

const good = 'Good-Pass-12a';

describe('new password rule', () => {
  it('accepts 12 characters with upper, lower, number, and symbol', () => {
    expect(passwordAccepted(good)).toBe(true);
    expect(passwordRuleMessage(good)).toBeNull();
    expect(passwordChecks('').map((row) => row.met)).toEqual([false, false, false, false, false]);
  });

  it('names each missing part, and sign-in is not this rule', () => {
    expect(passwordRuleMessage('good-pass-12a')).toMatch(/uppercase/);
    expect(passwordRuleMessage('GOOD-PASS-12A')).toMatch(/lowercase/);
    expect(passwordRuleMessage('Good-Pass-aaaa')).toMatch(/number/);
    expect(passwordRuleMessage('GoodPass12aaaa')).toMatch(/symbol/);
    expect(passwordRuleMessage('Good-1a')).toMatch(/12 characters/);
    expect(InviteAccept.safeParse({ token: 'x'.repeat(20), password: good }).success).toBe(true);
    expect(
      InviteAccept.safeParse({ token: 'x'.repeat(20), password: 'good-pass-12a' }).success,
    ).toBe(false);
    expect(
      PasswordReset.safeParse({ email: 'a@b.co', code: '123456', password: good }).success,
    ).toBe(true);
    expect(
      SignupRequestCreate.safeParse({
        name: 'A',
        email: 'a@b.co',
        password: 'long-enough-pass',
        requestedRole: 'business_manager',
      }).success,
    ).toBe(false);
  });
});
