import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  NOTIFICATION_TYPES,
  type CompanyMessage,
  type Notification,
  type NotificationType,
} from '@ariforce/contracts';
import {
  devices,
  jobs,
  notificationDeliveries,
  notifications,
  users,
  type Tx,
} from '@ariforce/db';
import { and, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { TenantService } from '../common/tenant.service';
import { JobsRunner } from '../jobs/jobs.runner';
import { JobsService } from '../jobs/jobs.service';
import { AUTO_APPROVE_REASON } from '../plans/auto-approve';
import { doctorOccasionRecipients, occasionSummary, occasionTitle } from './occasions';
import { deadPushTokens, isExpoPushToken, pushTicketsSettled, sendExpoPush } from './push';
import { render, type NotifyData } from './templates';

export interface NotifyEvent {
  type: NotificationType;
  recipientId: string | null | undefined;
  entityType: Notification['entityType'];
  entityId: string | null;
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
    runner.register('notification.deliver', ({ tx, companyId, payload }) =>
      this.deliverPush(tx, companyId!, payload),
    );
    runner.register('doctors.occasions', async ({ tx }) => {
      const r = await tx.execute<{ n: number }>(sql`select doctors_occasions_enqueue() as n`);
      this.log.log(`occasions: queued ${r.rows[0]?.n ?? 0} companies`);
    });
    runner.register('doctors.occasions.company', ({ tx, companyId, payload }) =>
      this.scanOccasions(tx, companyId!, payload),
    );
  }

  /** Director or system admin. One inbox row per other active user. The sender is not notified. */
  async broadcast(p: Principal, input: CompanyMessage) {
    if (!p.roles.includes('director') && !p.roles.includes('system_admin'))
      throw new ForbiddenException('Only a director or system admin can send a company message.');
    return this.tenant.run(p, async (tx) => {
      const rows = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.companyId, p.companyId),
            eq(users.status, 'active'),
            isNull(users.deletedAt),
            ne(users.id, p.userId),
          ),
        );
      const messageId = uuidv7();
      await this.notifyMany(
        tx,
        p,
        {
          type: 'company.message',
          entityType: null,
          entityId: null,
          dedupeKey: messageId,
          data: { title: input.title, body: input.body, messageId },
        },
        rows.map((r) => r.id),
      );
      return { recipients: rows.length };
    });
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
    const inserted = await tx
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
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    const id = inserted[0]?.id;
    if (!id) return;
    // The push job runs with the company set and no user, and notification SELECT is own-row only.
    // Carry the rendered copy in the payload so it does not have to read the inbox row.
    await this.jobs.enqueue(
      tx,
      companyId,
      'notification.deliver',
      {
        notificationId: id,
        userId: ev.recipientId,
        title,
        body,
        type: ev.type,
        entityType: ev.entityType,
        entityId: ev.entityId,
      },
      { dedupeKey: `push:${id}` },
    );
  }

  /** Company-local day from doctors_occasions_enqueue. One note per person; retries keep the same dedupe key. */
  private async scanOccasions(tx: Tx, companyId: string, payload: Record<string, unknown>) {
    const runDate = typeof payload.runDate === 'string' ? payload.runDate : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) throw new Error('doctors.occasions.company: bad runDate');
    const grouped = await doctorOccasionRecipients(tx, runDate);
    for (const [userId, lines] of grouped) {
      const one = lines.length === 1 ? lines[0] : undefined;
      await this.deliver(tx, companyId, {
        type: 'doctor.occasion',
        recipientId: userId,
        actorId: null,
        entityType: one ? 'doctor' : null,
        entityId: one?.doctorId ?? null,
        dedupeKey: `${runDate}:occasions`,
        data: { title: occasionTitle(lines), summary: occasionSummary(lines) },
      });
    }
    this.log.log(`occasions ${runDate}: ${grouped.size} people`);
  }

  /** Best-effort phone banner. A failure retries the job and does not remove the inbox row. */
  private async deliverPush(tx: Tx, companyId: string, payload: Record<string, unknown>) {
    const notificationId = typeof payload.notificationId === 'string' ? payload.notificationId : '';
    const userId = typeof payload.userId === 'string' ? payload.userId : '';
    const title = typeof payload.title === 'string' ? payload.title : '';
    const body = typeof payload.body === 'string' ? payload.body : '';
    const type = typeof payload.type === 'string' ? payload.type : '';
    const entityType = typeof payload.entityType === 'string' ? payload.entityType : null;
    const entityId = typeof payload.entityId === 'string' ? payload.entityId : null;
    if (!notificationId || !userId) return;
    const rows = await tx
      .select({ id: devices.id, pushToken: devices.pushToken })
      .from(devices)
      .where(
        and(
          eq(devices.userId, userId),
          inArray(devices.status, ['active', 'pending_consent']),
          isNull(devices.deletedAt),
        ),
      );
    const tokens = [
      ...new Set(rows.map((r) => r.pushToken).filter((t): t is string => !!t && isExpoPushToken(t))),
    ];
    if (!tokens.length) {
      await tx
        .insert(notificationDeliveries)
        .values({
          id: uuidv7(),
          companyId,
          notificationId,
          channel: 'push',
          status: 'skipped',
          attempts: 1,
        })
        .onConflictDoNothing();
      return;
    }
    const messages = tokens.map((to) => ({
      to,
      title,
      body,
      sound: 'default' as const,
      channelId: 'default',
      data: { notificationId, type, entityType, entityId },
    }));
    const tickets = await sendExpoPush(messages);
    if (tickets.length !== messages.length) throw new Error('Expo push returned an unexpected ticket count');
    const dead = deadPushTokens(messages, tickets);
    if (dead.length)
      await tx
        .update(devices)
        .set({ pushToken: null })
        .where(and(eq(devices.userId, userId), inArray(devices.pushToken, dead)));
    if (!pushTicketsSettled(tickets)) {
      const err = tickets.find((t) => t.status === 'error');
      throw new Error(err?.message || 'Expo push failed');
    }
    const sent = tickets.some((t) => t.status === 'ok');
    await tx
      .insert(notificationDeliveries)
      .values({
        id: uuidv7(),
        companyId,
        notificationId,
        channel: 'push',
        status: sent ? 'sent' : 'skipped',
        attempts: 1,
        sentAt: sent ? new Date() : null,
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
