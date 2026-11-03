import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NOTIFICATION_TYPES, type Notification, type NotificationType } from '@ariforce/contracts';
import { jobs, notifications, users, type Tx } from '@ariforce/db';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { TenantService } from '../common/tenant.service';
import { JobsRunner } from '../jobs/jobs.runner';
import { JobsService } from '../jobs/jobs.service';
import { AUTO_APPROVE_REASON } from '../plans/auto-approve';
import { render, type NotifyData } from './templates';

export interface NotifyEvent {
  type: NotificationType;
  recipientId: string | null | undefined;
  entityType: NonNullable<Notification['entityType']>;
  entityId: string;
  /** Unique per recipient: replays never create a second notification. */
  dedupeKey: string;
  data?: Record<string, unknown>;
}

const encode = (id: string) => Buffer.from(id).toString('base64url');
const decode = (c?: string) => {
  if (!c) return undefined;
  const id = Buffer.from(c, 'base64url').toString();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : undefined;
};

/** In-app notifications (#35). Own rows only: RLS (user_id = app_user_id()) plus an explicit filter. */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');
  constructor(
    private readonly tenant: TenantService,
    private readonly jobs: JobsService,
    runner: JobsRunner,
  ) {
    runner.register('notify', ({ tx, companyId, payload }) =>
      this.deliver(tx, companyId!, payload as unknown as NotifyEvent & { actorId: string | null }),
    );
  }

  /**
   * Called inside the business transaction. Savepoint: a failure here is logged and swallowed so the
   * business change still commits. Self-notifications are skipped, except for the system principal
   * (director auto-approvals): then the director is told, actorId is null and data.autoApproved true.
   */
  async notify(tx: Tx, p: Principal, ev: NotifyEvent) {
    if (!ev.recipientId || (!p.system && ev.recipientId === p.userId)) return;
    const e: NotifyEvent = p.system
      ? { ...ev, data: { ...(ev.data ?? {}), autoApproved: true, reason: AUTO_APPROVE_REASON } }
      : ev;
    try {
      await tx.transaction((sp) =>
        this.jobs.enqueue(
          sp,
          p.companyId,
          'notify',
          { ...e, actorId: p.system ? null : p.userId },
          { dedupeKey: `${ev.recipientId}:${ev.dedupeKey}` },
        ),
      );
    } catch (e) {
      this.log.error(`enqueue ${ev.type} failed: ${(e as Error).message}`);
    }
  }

  /**
   * notify() for each recipient (deduped; null / self skipped as in notify()), as one multi-row job
   * insert in one savepoint per event.
   */
  async notifyMany(
    tx: Tx,
    p: Principal,
    ev: Omit<NotifyEvent, 'recipientId'>,
    recipientIds: (string | null | undefined)[],
  ) {
    const to = [...new Set(recipientIds)].filter(
      (r): r is string => !!r && (p.system || r !== p.userId),
    );
    if (!to.length) return;
    if (to.length === 1) return this.notify(tx, p, { ...ev, recipientId: to[0]! });
    const data = p.system
      ? { ...(ev.data ?? {}), autoApproved: true, reason: AUTO_APPROVE_REASON }
      : ev.data;
    try {
      await tx.transaction((sp) =>
        this.jobs.enqueueMany(
          sp,
          p.companyId,
          'notify',
          to.map((r) => ({
            payload: {
              ...ev,
              ...(data !== undefined && { data }),
              recipientId: r,
              actorId: p.system ? null : p.userId,
            },
            dedupeKey: `${r}:${ev.dedupeKey}`,
          })),
        ),
      );
    } catch (e) {
      this.log.error(`enqueue ${ev.type} failed: ${(e as Error).message}`);
    }
  }

  /**
   * Reviewers of `userId`: the manager chain upward (max 6 levels), active, holding `perm` through a
   * role. Never throws: a failure is logged and nobody is returned.
   */
  async reviewerChain(tx: Tx, userId: string, perm: string): Promise<string[]> {
    try {
      return await tx.transaction(async (sp) => {
        const r = await sp.execute<{ id: string }>(sql`with recursive up(id, depth) as (
            select manager_id, 1 from users where id = ${userId} and manager_id is not null
            union all
            select u.manager_id, up.depth + 1 from up join users u on u.id = up.id
            where u.manager_id is not null and up.depth < 6)
          select up.id from up join users u on u.id = up.id
          where u.deleted_at is null and u.status = 'active' and exists (
            select 1 from user_roles ur join roles r on r.id = ur.role_id
            where ur.user_id = up.id and r.deleted_at is null and ${perm} = any(r.permissions))
          order by up.depth`);
        return r.rows.map((x) => x.id);
      });
    } catch (e) {
      this.log.error(`reviewerChain failed: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * For events about an action that failed and rolled back (expense.blocked): a separate tenant
   * transaction after the failure. Best effort; never throws.
   */
  async afterRollback(p: Principal, fn: (tx: Tx) => Promise<void>) {
    try {
      await this.tenant.run(p, fn);
    } catch (e) {
      this.log.error(`afterRollback notify failed: ${(e as Error).message}`);
    }
  }

  /** Job handler: render + insert (idempotent via the (user_id, dedupe_key) unique index). */
  private async deliver(tx: Tx, companyId: string, ev: NotifyEvent & { actorId: string | null }) {
    if (!NOTIFICATION_TYPES.includes(ev.type)) throw new Error(`Unknown type ${String(ev.type)}`);
    const [actor] = ev.actorId
      ? await tx.select({ name: users.name }).from(users).where(eq(users.id, ev.actorId))
      : [{ name: 'AriForce' }];
    const data: NotifyData = {
      ...(ev.data ?? {}),
      actorId: ev.actorId ?? null,
      actorName: actor?.name,
    };
    const { title, body } = render(ev.type, data);
    await tx
      .insert(notifications)
      .values({
        id: uuidv7(),
        companyId,
        userId: ev.recipientId!,
        type: ev.type,
        title,
        body,
        entityType: ev.entityType,
        entityId: ev.entityId,
        data: data as Record<string, unknown>,
        dedupeKey: ev.dedupeKey,
      })
      .onConflictDoNothing();
  }

  private dto(r: typeof notifications.$inferSelect): Notification {
    return {
      id: r.id,
      type: r.type as NotificationType,
      title: r.title,
      body: r.body,
      entityType: (r.entityType as Notification['entityType']) ?? null,
      entityId: r.entityId,
      data: r.data ?? null,
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  list(p: Principal, q: { limit?: number; cursor?: string; unreadOnly?: 'true' | 'false' }) {
    return this.tenant.run(p, async (tx) => {
      const limit = q.limit ?? 30;
      const after = decode(q.cursor);
      const rows = await tx
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, p.userId),
            q.unreadOnly === 'true' ? isNull(notifications.readAt) : undefined,
            after ? lt(notifications.id, after) : undefined,
          ),
        )
        .orderBy(desc(notifications.id))
        .limit(limit + 1);
      const items = rows.slice(0, limit).map((r) => this.dto(r));
      return {
        items,
        nextCursor: rows.length > limit ? encode(items.at(-1)!.id) : null,
        serverTime: new Date().toISOString(),
      };
    });
  }

  unreadCount(p: Principal) {
    return this.tenant.run(p, async (tx) => {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, p.userId), isNull(notifications.readAt)));
      return { count: r?.n ?? 0 };
    });
  }

  read(p: Principal, id: string) {
    return this.tenant.run(p, async (tx) => {
      const [r] = await tx
        .update(notifications)
        .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
        .where(and(eq(notifications.id, id), eq(notifications.userId, p.userId)))
        .returning();
      if (!r) throw new NotFoundException('Notification not found');
      return this.dto(r);
    });
  }

  readAll(p: Principal) {
    return this.tenant.run(p, async (tx) => {
      const r = await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, p.userId), isNull(notifications.readAt)))
        .returning({ id: notifications.id });
      return { updated: r.length };
    });
  }

  /** System admin only; RLS limits it to the caller's company. */
  jobStats(p: Principal) {
    if (!p.roles.includes('system_admin')) throw new ForbiddenException('System admin only');
    return this.tenant.run(p, async (tx) => {
      const rows = await tx
        .select({ status: jobs.status, n: sql<number>`count(*)::int` })
        .from(jobs)
        .groupBy(jobs.status);
      const out = { queued: 0, running: 0, done: 0, dead: 0 };
      for (const r of rows) out[r.status] = r.n;
      return out;
    });
  }
}
