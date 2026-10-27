import { Injectable, Logger } from '@nestjs/common';
import {
  EXCEPTION_RULES,
  SEVERITY_RANK,
  type ExceptionItem,
  type ExceptionListQuery,
  type ExceptionRule,
  type ExceptionRuleCode,
  type ExceptionRuleUpdate,
  type ExceptionSummary,
  type ExceptionUpdate,
} from '@ariforce/contracts';
import { exceptionRules, exceptions, users, type Tx } from '@ariforce/db';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { companySettings, localDate } from '../field/field.util';
import { JobsRunner } from '../jobs/jobs.runner';
import { JobsService } from '../jobs/jobs.service';
import { decodeCursor, encodeCursor } from '../masters/masters.service';
import { addDays, datesBetween, effectiveRules, evaluateExceptions } from './exceptions.engine';

type Row = typeof exceptions.$inferSelect;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_EVAL_DAYS = 92;
const sevRank = sql`(case ${exceptions.severity} when 'high' then 3 when 'medium' then 2 else 1 end)`;

/** Exception and Alert Center (#56). docs/EXCEPTIONS.md. */
@Injectable()
export class ExceptionsService {
  private readonly log = new Logger('Exceptions');
  constructor(
    private readonly tenant: TenantService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    runner: JobsRunner,
  ) {
    runner.register('exceptions.evaluate', async ({ tx, companyId, payload }) => {
      const from = String(payload.from ?? '');
      const to = String(payload.to ?? '');
      if (!companyId || !DATE.test(from) || !DATE.test(to) || from > to)
        throw new Error('exceptions.evaluate: bad payload');
      if (datesBetween(from, to).length > MAX_EVAL_DAYS)
        throw new Error('exceptions.evaluate: range too long');
      const r = await evaluateExceptions(tx, companyId, from, to, {
        notify: payload.notify === true,
        runDate: typeof payload.runDate === 'string' ? payload.runDate : undefined,
      });
      this.log.log(`evaluate ${from}..${to}: ${JSON.stringify(r)}`);
    });
    runner.register('exceptions.daily', async ({ tx }) => {
      const r = await tx.execute<{ n: number }>(sql`select exceptions_enqueue_daily() as n`);
      this.log.log(`daily: queued ${r.rows[0]?.n ?? 0} company evaluations`);
    });
  }

  private scope(p: Principal): SQL | undefined {
    if (p.teamUserIds === null) return undefined;
    return p.teamUserIds.length ? inArray(exceptions.userId, p.teamUserIds) : sql`false`;
  }

  private async names(tx: Tx, ids: (string | null)[]) {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return new Map<string, string>();
    const r = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, uniq));
    return new Map(r.map((x) => [x.id, x.name]));
  }

  private async dtos(tx: Tx, rs: Row[]): Promise<ExceptionItem[]> {
    const n = await this.names(
      tx,
      rs.flatMap((r) => [r.userId, r.assigneeId, r.resolvedBy]),
    );
    const rules = new Map((await effectiveRules(tx)).map((r) => [r.code, r]));
    const ref = (id: string | null) => (id ? { id, name: n.get(id) ?? '' } : null);
    const numOrNull = (v: string | null) => (v === null ? null : Number(v));
    return rs.map((r) => {
      const code = r.ruleCode as ExceptionRuleCode;
      const rule = rules.get(code);
      return {
        id: r.id,
        ruleCode: code,
        ruleName: rule?.name ?? EXCEPTION_RULES[code]?.name ?? r.ruleCode,
        severity: r.severity,
        status: r.status,
        periodDate: r.periodDate,
        user: ref(r.userId)!,
        assignee: ref(r.assigneeId),
        followUpOn: r.followUpOn,
        value: numOrNull(r.value),
        threshold: numOrNull(r.threshold),
        context: r.context ?? {},
        suggestedAction: rule?.action ?? '',
        explanation: r.explanation,
        explainedAt: r.explainedAt?.toISOString() ?? null,
        resolutionNote: r.resolutionNote,
        resolvedBy: ref(r.resolvedBy),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        autoResolved: r.autoResolved,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        version: r.version,
      };
    });
  }

  list(p: Principal, q: ExceptionListQuery) {
    return this.tenant.run(p, async (tx) => {
      const limit = q.limit ?? 50;
      const offset = decodeCursor(q.cursor);
      const where = and(
        sql`${exceptions.deletedAt} is null`,
        this.scope(p),
        q.status?.length ? inArray(exceptions.status, q.status) : undefined,
        q.severity?.length ? inArray(exceptions.severity, q.severity) : undefined,
        q.ruleCode?.length ? inArray(exceptions.ruleCode, q.ruleCode) : undefined,
        q.userId ? eq(exceptions.userId, q.userId) : undefined,
        q.assignedToMe === 'true' ? eq(exceptions.assigneeId, p.userId) : undefined,
        q.from ? sql`${exceptions.periodDate} >= ${q.from}::date` : undefined,
        q.to ? sql`${exceptions.periodDate} <= ${q.to}::date` : undefined,
      );
      const rs = await tx
        .select()
        .from(exceptions)
        .where(where)
        .orderBy(
          sql`${sevRank} desc`,
          sql`${exceptions.periodDate} desc`,
          sql`${exceptions.id} desc`,
        )
        .limit(limit + 1)
        .offset(offset);
      const items = await this.dtos(tx, rs.slice(0, limit));
      return {
        items,
        nextCursor: rs.length > limit ? encodeCursor(offset + limit) : null,
        serverTime: new Date().toISOString(),
      };
    });
  }

  summary(p: Principal, q: { from?: string; to?: string; userId?: string }) {
    return this.tenant.run(p, async (tx): Promise<ExceptionSummary> => {
      const s = await companySettings(tx, p);
      const today = localDate(new Date(), s.timezone);
      const to = q.to ?? today;
      const from = q.from ?? addDays(to, -30);
      const rs = await tx
        .select({
          rule: exceptions.ruleCode,
          severity: exceptions.severity,
          open: sql<boolean>`${exceptions.status} in ('open','acknowledged')`,
          n: sql<number>`count(*)::int`,
        })
        .from(exceptions)
        .where(
          and(
            sql`${exceptions.deletedAt} is null`,
            this.scope(p),
            q.userId ? eq(exceptions.userId, q.userId) : undefined,
            sql`${exceptions.periodDate} between ${from}::date and ${to}::date`,
          ),
        )
        .groupBy(exceptions.ruleCode, exceptions.severity, sql`3`);
      const rules = await effectiveRules(tx);
      const out: ExceptionSummary = {
        from,
        to,
        total: 0,
        open: 0,
        bySeverity: { low: 0, medium: 0, high: 0 },
        openBySeverity: { low: 0, medium: 0, high: 0 },
        byRule: [],
      };
      const byRule = new Map<string, { total: number; open: number }>();
      for (const r of rs) {
        out.total += r.n;
        out.bySeverity[r.severity] += r.n;
        if (r.open) {
          out.open += r.n;
          out.openBySeverity[r.severity] += r.n;
        }
        const b = byRule.get(r.rule) ?? { total: 0, open: 0 };
        b.total += r.n;
        if (r.open) b.open += r.n;
        byRule.set(r.rule, b);
      }
      out.byRule = rules
        .filter((r) => byRule.has(r.code))
        .map((r) => ({ ruleCode: r.code, severity: r.severity, ...byRule.get(r.code)! }))
        .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.total - a.total);
      return out;
    });
  }

  /** Row in the caller's scope or 404. */
  private async load(tx: Tx, p: Principal, id: string): Promise<Row> {
    if (!UUID.test(id)) throw err(404, 'NOT_FOUND', 'Exception not found');
    const [r] = await tx
      .select()
      .from(exceptions)
      .where(and(eq(exceptions.id, id), sql`${exceptions.deletedAt} is null`, this.scope(p)))
      .for('update');
    if (!r) throw err(404, 'NOT_FOUND', 'Exception not found');
    return r;
  }

  get(p: Principal, id: string) {
    return this.tenant.run(
      p,
      async (tx) => (await this.dtos(tx, [await this.load(tx, p, id)]))[0]!,
    );
  }

  private open(r: Row) {
    if (r.status !== 'open' && r.status !== 'acknowledged')
      throw err(409, 'EXCEPTION_CLOSED', `Exception is ${r.status}`);
  }

  /** Manager action: strictly below the caller (not own). */
  private manage(p: Principal, r: Row) {
    if (r.userId === p.userId)
      throw err(403, 'FORBIDDEN', 'You cannot resolve, dismiss or assign your own exceptions');
  }

  private async save(tx: Tx, p: Principal, r: Row, set: Partial<Row>, action: string) {
    const [u] = await tx.update(exceptions).set(set).where(eq(exceptions.id, r.id)).returning();
    await this.audit.record(tx, p, action, {
      entityType: 'exception',
      entityId: r.id,
      before: { status: r.status, assigneeId: r.assigneeId, followUpOn: r.followUpOn },
      after: { status: u!.status, assigneeId: u!.assigneeId, followUpOn: u!.followUpOn },
    });
    return (await this.dtos(tx, [u!]))[0]!;
  }

  explain(p: Principal, id: string, note: string) {
    return this.tenant.run(p, async (tx) => {
      const r = await this.load(tx, p, id);
      if (r.userId !== p.userId)
        throw err(403, 'FORBIDDEN', 'Only the person the exception is about can explain it');
      this.open(r);
      return this.save(
        tx,
        p,
        r,
        { explanation: note, explainedAt: new Date(), status: 'acknowledged' },
        'exception.explain',
      );
    });
  }

  close(p: Principal, id: string, note: string, status: 'resolved' | 'dismissed') {
    return this.tenant.run(p, async (tx) => {
      const r = await this.load(tx, p, id);
      this.manage(p, r);
      this.open(r);
      return this.save(
        tx,
        p,
        r,
        {
          status,
          resolutionNote: note,
          resolvedBy: p.userId,
          resolvedAt: new Date(),
          autoResolved: false,
        },
        status === 'resolved' ? 'exception.resolve' : 'exception.dismiss',
      );
    });
  }

  update(p: Principal, id: string, b: ExceptionUpdate) {
    return this.tenant.run(p, async (tx) => {
      const r = await this.load(tx, p, id);
      this.manage(p, r);
      this.open(r);
      if (b.version !== undefined && b.version !== r.version)
        throw err(409, 'VERSION_CONFLICT', 'Exception changed; reload', { version: r.version });
      if (b.assigneeId) {
        const ok =
          b.assigneeId === p.userId ||
          p.teamUserIds === null ||
          p.teamUserIds.includes(b.assigneeId);
        const [u] = ok
          ? await tx
              .select({ id: users.id })
              .from(users)
              .where(and(eq(users.id, b.assigneeId), eq(users.status, 'active')))
          : [];
        if (!u)
          throw err(422, 'ASSIGNEE_OUT_OF_SCOPE', 'Assignee must be you or someone in your team');
      }
      const set: Partial<Row> = {};
      if (b.assigneeId !== undefined) set.assigneeId = b.assigneeId;
      if (b.followUpOn !== undefined) set.followUpOn = b.followUpOn;
      return this.save(tx, p, r, set, 'exception.update');
    });
  }

  rules(p: Principal) {
    return this.tenant.run(p, async (tx) => ({ items: await effectiveRules(tx) }));
  }

  updateRule(p: Principal, code: ExceptionRuleCode, b: ExceptionRuleUpdate) {
    return this.tenant.run(p, async (tx): Promise<ExceptionRule> => {
      const d = EXCEPTION_RULES[code];
      const [cur] = await tx
        .select()
        .from(exceptionRules)
        .where(eq(exceptionRules.code, code))
        .for('update');
      const live = cur && !cur.deletedAt ? cur : undefined;
      if (b.version !== undefined && b.version !== (live?.version ?? null))
        throw err(409, 'VERSION_CONFLICT', 'Rule changed; reload', {
          version: live?.version ?? null,
        });
      if (b.threshold !== undefined) {
        if (d.threshold === null)
          throw err(422, 'THRESHOLD_OUT_OF_RANGE', 'This rule has no threshold');
        if (b.threshold < (d.thresholdMin ?? 0) || b.threshold > (d.thresholdMax ?? 1000))
          throw err(
            422,
            'THRESHOLD_OUT_OF_RANGE',
            `Threshold must be ${d.thresholdMin}-${d.thresholdMax}`,
            {
              min: d.thresholdMin,
              max: d.thresholdMax,
            },
          );
      }
      const before = (await effectiveRules(tx)).find((r) => r.code === code)!;
      if (b.reset) {
        if (live)
          await tx
            .update(exceptionRules)
            .set({ deletedAt: new Date() })
            .where(eq(exceptionRules.id, live.id));
      } else {
        const vals = {
          enabled: b.enabled ?? live?.enabled ?? true,
          severity: b.severity ?? live?.severity ?? d.severity,
          threshold:
            b.threshold !== undefined
              ? String(b.threshold)
              : (live?.threshold ?? (d.threshold === null ? null : String(d.threshold))),
          action: b.action ?? live?.action ?? null,
        };
        if (cur)
          await tx
            .update(exceptionRules)
            .set({ ...vals, deletedAt: null })
            .where(eq(exceptionRules.id, cur.id));
        else
          await tx
            .insert(exceptionRules)
            .values({ id: uuidv7(), companyId: p.companyId, code, ...vals });
      }
      const after = (await effectiveRules(tx)).find((r) => r.code === code)!;
      await this.audit.record(tx, p, 'exception_rule.update', {
        entityType: 'exception_rule',
        entityId: null,
        before,
        after,
      });
      return after;
    });
  }

  evaluate(p: Principal, b: { from: string; to: string }) {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      const today = localDate(new Date(), s.timezone);
      if (b.to >= today) throw err(422, 'VALIDATION', 'to must be before today');
      if (datesBetween(b.from, b.to).length > MAX_EVAL_DAYS)
        throw err(422, 'VALIDATION', `At most ${MAX_EVAL_DAYS} days`);
      await this.jobs.enqueue(tx, p.companyId, 'exceptions.evaluate', {
        from: b.from,
        to: b.to,
        notify: false,
      });
      await this.audit.record(tx, p, 'exception.evaluate', { after: b });
      return { queued: true, from: b.from, to: b.to };
    });
  }
}
