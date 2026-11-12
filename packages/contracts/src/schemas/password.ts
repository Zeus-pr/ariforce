import * as z from 'zod';

/**
 * Rule for a newly chosen password (invite, sign-up, forgot password).
 * Sign-in does not use this, so a password set earlier still works.
 * Length is characters, not bytes.
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export const PASSWORD_RULES = [
  {
    id: 'length',
    label: 'At least 12 characters',
    test: (password: string) => password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX,
  },
  {
    id: 'lower',
    label: 'One lowercase letter',
    test: (password: string) => /[a-z]/.test(password),
  },
  {
    id: 'upper',
    label: 'One uppercase letter',
    test: (password: string) => /[A-Z]/.test(password),
  },
  {
    id: 'number',
    label: 'One number',
    test: (password: string) => /\d/.test(password),
  },
  {
    id: 'symbol',
    label: 'One symbol',
    test: (password: string) => /[^A-Za-z0-9]/.test(password),
  },
] as const;

export type PasswordRuleId = (typeof PASSWORD_RULES)[number]['id'];

/** HTML pattern attribute. Full match, same rules as `passwordAccepted`. */
export const PASSWORD_PATTERN = '(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{12,128}';

export function passwordChecks(password: string) {
  return PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    met: rule.test(password),
  }));
}

export function passwordAccepted(password: string) {
  return PASSWORD_RULES.every((rule) => rule.test(password));
}

/** What is still missing, or null when the password is acceptable. */
export function passwordRuleMessage(password: string): string | null {
  const missing = PASSWORD_RULES.filter((rule) => !rule.test(password));
  if (!missing.length) return null;
  return `Password needs ${missing.map((rule) => rule.label.toLowerCase()).join(', ')}.`;
}

export const NewPassword = z
  .string()
  .max(PASSWORD_MAX)
  .superRefine((value, ctx) => {
    const message = passwordRuleMessage(value);
    if (message) ctx.addIssue({ code: 'custom', message });
  })
  .meta({
    description:
      '12–128 characters, with one uppercase letter, one lowercase letter, one number, and one symbol',
  });
