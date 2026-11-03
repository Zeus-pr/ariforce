import { Inject, Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Short label for logs and tests, e.g. 'invite' or 'password_reset'. Never the content. */
  kind: string;
}

/** Transport. Production: Resend. Tests override MAIL_SENDER with a capturing fake. */
export interface MailSender {
  send(m: MailMessage): Promise<void>;
}
export const MAIL_SENDER = Symbol('MAIL_SENDER');

/** RESEND_API_KEY unset: nothing leaves the process; logs recipient and kind only (never codes or links). */
export class LogMailSender implements MailSender {
  private readonly log = new Logger('Mail');
  async send(m: MailMessage) {
    this.log.log(`mail ${m.kind} to ${m.to} not sent (RESEND_API_KEY unset)`);
  }
}

export class ResendMailSender implements MailSender {
  private readonly client: Resend;
  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }
  async send(m: MailMessage) {
    const r = await this.client.emails.send({
      from: this.from,
      to: m.to,
      subject: m.subject,
      text: m.text,
      ...(m.html ? { html: m.html } : {}),
    });
    if (r.error) throw new Error(`Resend ${m.kind} failed: ${r.error.name}`);
  }
}

export const DEFAULT_MAIL_FROM = 'AriForce <no-reply@localhost>';
export function mailSenderFromEnv(): MailSender {
  const key = process.env.RESEND_API_KEY;
  return key
    ? new ResendMailSender(key, process.env.MAIL_FROM ?? DEFAULT_MAIL_FROM)
    : new LogMailSender();
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Application emails. Failures are logged, never thrown to the caller (no account enumeration). */
@Injectable()
export class MailService {
  private readonly log = new Logger('MailService');
  constructor(@Inject(MAIL_SENDER) private readonly sender: MailSender) {}

  async send(m: MailMessage): Promise<boolean> {
    try {
      await this.sender.send(m);
      return true;
    } catch (e) {
      this.log.error(`mail ${m.kind} failed: ${(e as Error).message}`);
      return false;
    }
  }

  invite(to: string, name: string, link: string, expiresAt: Date) {
    const until = expiresAt.toISOString().slice(0, 10);
    return this.send({
      kind: 'invite',
      to,
      subject: 'You are invited to AriForce',
      text: `Hello ${name},\n\nYou have been invited to AriForce. Set your password here (valid until ${until}):\n${link}\n\nIf you did not expect this, ignore this email.`,
      html: `<p>Hello ${esc(name)},</p><p>You have been invited to AriForce. <a href="${esc(link)}">Set your password</a> (valid until ${until}).</p><p>If you did not expect this, ignore this email.</p>`,
    });
  }

  passwordResetCode(to: string, code: string, minutes: number) {
    return this.send({
      kind: 'password_reset',
      to,
      subject: 'Your AriForce password reset code',
      text: `Your AriForce password reset code is ${code}. It expires in ${minutes} minutes and can be tried 3 times.\n\nIf you did not ask for this, ignore this email; your password is unchanged.`,
      html: `<p>Your AriForce password reset code is <strong>${esc(code)}</strong>.</p><p>It expires in ${minutes} minutes and can be tried 3 times.</p><p>If you did not ask for this, ignore this email; your password is unchanged.</p>`,
    });
  }

  loginCode(to: string, code: string, minutes: number) {
    return this.send({
      kind: 'login_code',
      to,
      subject: 'Your AriForce sign-in code',
      text: `Your AriForce sign-in code is ${code}. It expires in ${minutes} minutes and can be tried 3 times.\n\nIf you did not try to sign in, change your password.`,
      html: `<p>Your AriForce sign-in code is <strong>${esc(code)}</strong>.</p><p>It expires in ${minutes} minutes and can be tried 3 times.</p><p>If you did not try to sign in, change your password.</p>`,
    });
  }
}
