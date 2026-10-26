import { Inject, Injectable } from '@nestjs/common';
import { SignupRequestCreate, AUTH_STATE_CODES } from '@ariforce/contracts';
import {
  auditLog,
  authAccount,
  authUser,
  signupRequests,
  territories,
  users,
  withTenant,
  type Db,
} from '@ariforce/db';
import { hashPassword } from 'better-auth/crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type * as z from 'zod';
import { DB } from '../db/db.module';
import { err } from '../field/checkins.service';

const HOUR = 3600_000;
/** Fixed-window in-memory limiter (single API instance; swap for KV/Redis when scaled out). */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  hit(key: string, limit: number, windowMs = HOUR) {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.reset <= now) {
      this.hits.set(key, { n: 1, reset: now + windowMs });
      return true;
    }
    h.n += 1;
    return h.n <= limit;
  }
  reset() {
    this.hits.clear();
  }
}

/** Generic on purpose: never reveals whether the email already has a login. */
const UNAVAILABLE = () =>
  err(
    409,
    AUTH_STATE_CODES.unavailable,
    'We could not create an account with these details. If you already have an account, sign in or contact your administrator.',
  );

/** Optional Cloudflare Turnstile check; active only when TURNSTILE_SECRET is set. */
export async function verifyTurnstile(token: string | undefined, ip: string | null) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true;
  if (!token) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    return ((await r.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}

@Injectable()
export class SignupService {
  readonly limiter = new RateLimiter();
  constructor(@Inject(DB) private readonly db: Db) {}

  async submit(b: z.infer<typeof SignupRequestCreate>, ip: string | null) {
    const email = b.email.trim().toLowerCase();
    const perIp = Number(process.env.SIGNUP_RATE_PER_IP ?? 10);
    const perEmail = Number(process.env.SIGNUP_RATE_PER_EMAIL ?? 3);
    if (
      !this.limiter.hit(`ip:${ip ?? '?'}`, perIp) ||
      !this.limiter.hit(`email:${email}`, perEmail)
    )
      throw err(429, AUTH_STATE_CODES.rateLimited, 'Too many sign-up attempts; try again later');
    if (!(await verifyTurnstile(b.turnstileToken, ip)))
      throw err(403, AUTH_STATE_CODES.captcha, 'Verification failed; please retry');

    const slug = process.env.SIGNUP_COMPANY_SLUG ?? 'arighna';
    const c = await this.db.execute<{ id: string | null }>(
      sql`select company_id_by_slug(${slug}) as id`,
    );
    const companyId = c.rows[0]?.id;
    if (!companyId) throw err(503, 'SIGNUP_DISABLED', 'Sign-up is not available right now');
    const hash = await hashPassword(b.password);

    return withTenant(this.db, { companyId, userId: null }, async (tx) => {
      const taken = await tx
        .select({ id: authUser.id })
        .from(authUser)
        .where(eq(authUser.email, email));
      if (taken.length) throw UNAVAILABLE();
      const [row] = await tx
        .select()
        .from(users)
        .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deletedAt)));
      if (row && (row.authUserId || !['active', 'invited'].includes(row.status)))
        throw UNAVAILABLE();
      if (b.territoryId) {
        const t = await tx
          .select({ id: territories.id })
          .from(territories)
          .where(and(eq(territories.id, b.territoryId), isNull(territories.deletedAt)));
        if (!t.length) throw err(422, 'VALIDATION', 'Unknown territory');
      }
      if (b.managerId) {
        const m = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(eq(users.id, b.managerId), eq(users.status, 'active'), isNull(users.deletedAt)),
          );
        if (!m.length) throw err(422, 'VALIDATION', 'Unknown manager');
      }
      const authId = randomUUID();
      await tx.insert(authUser).values({ id: authId, name: b.name, email, emailVerified: false });
      await tx.insert(authAccount).values({
        id: randomUUID(),
        accountId: authId,
        providerId: 'credential',
        userId: authId,
        password: hash,
      });
      let userId: string;
      if (row) {
        userId = row.id;
        await tx
          .update(users)
          .set({
            authUserId: authId,
            status: 'pending',
            phone: row.phone ?? b.phone,
            updatedAt: new Date(),
          })
          .where(eq(users.id, row.id));
      } else {
        const [u] = await tx
          .insert(users)
          .values({
            companyId,
            authUserId: authId,
            email,
            name: b.name,
            phone: b.phone,
            status: 'pending',
          })
          .returning({ id: users.id });
        userId = u!.id;
      }
      const [r] = await tx
        .insert(signupRequests)
        .values({
          companyId,
          userId,
          requestedRole: b.requestedRole,
          requestedTerritoryId: b.territoryId,
          requestedManagerId: b.managerId,
        })
        .returning({ id: signupRequests.id });
      await tx.insert(auditLog).values({
        companyId,
        actorUserId: userId,
        action: 'signup.requested',
        entityType: 'signup_request',
        entityId: r!.id,
        after: {
          requestedRole: b.requestedRole,
          territoryId: b.territoryId,
          managerId: b.managerId,
          linkedExisting: !!row,
        },
        ip,
      });
      return {
        status: 'pending' as const,
        message: 'Request received. You can sign in once an administrator approves it.',
      };
    });
  }
}
