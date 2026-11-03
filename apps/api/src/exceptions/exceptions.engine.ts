import {
  EXCEPTION_RULE_CODES,
  EXCEPTION_RULES,
  type ExceptionRule,
  type ExceptionRuleCode,
  type ExceptionSeverity,
} from '@ariforce/contracts';
import { exceptionRules, exceptions, notifications, type Tx } from '@ariforce/db';
import { and, between, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { render } from '../notifications/templates';

async function rows<T>(tx: Tx, q: SQL): Promise<T[]> {
  const r = await tx.execute(q);
  return ((r as unknown as { rows?: T[] }).rows ?? (r as unknown as T[])) as T[];
}
const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(ms(d) + n * DAY);
export function datesBetween(from: string, to: string) {
  const out: string[] = [];
  for (let t = ms(from); t <= ms(to); t += DAY) out.push(iso(t));
  return out;
}
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const nextMonth = (d: string) => {
  const [y, m] = d.split('-').map(Number) as [number, number];
  return iso(Date.UTC(y, m, 1));
};
const isMonthEnd = (d: string) => addDays(d, 1).endsWith('-01');

/** Effective rules: code defaults merged with the company's exception_rules overrides. */
export async function effectiveRules(tx: Tx): Promise<ExceptionRule[]> {
  const over = await tx.select().from(exceptionRules);
  const by = new Map(over.filter((o) => !o.deletedAt).map((o) => [o.code, o]));
  return EXCEPTION_RULE_CODES.map((code) => {
    const d = EXCEPTION_RULES[code];
    const o = by.get(code);
    return {
      code,
      name: d.name,
      description: d.description,
      grain: d.grain,
      enabled: o ? o.enabled : true,
      severity: (o?.severity ?? d.severity) as ExceptionSeverity,
      threshold:
        d.threshold === null ? null : o?.threshold != null ? Number(o.threshold) : d.threshold,
      thresholdUnit: d.thresholdUnit,
      action: o?.action ?? d.action,
      isDefault: !o,
      version: o?.version ?? null,
    };
  });
}

type Hit = { value: number | null; context: Record<string, unknown> };
type Key = `${string}|${ExceptionRuleCode}|${string}`;
const stable = (o: Record<string, unknown>) =>
  JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))));
const key = (u: string, r: ExceptionRuleCode, d: string) => `${u}|${r}|${d}` as Key;

export interface EvalResult {
  evaluated: number;
  created: number;
  updated: number;
  autoResolved: number;
  reopened: number;
  notified: number;
}

/**
 * Evaluate every enabled rule for [from, to] (company-local dates) in the current tenant transaction.
 * Idempotent: upsert on (company, user, rule, period); manager-closed rows are never touched.
 */
export async function evaluateExceptions(
  tx: Tx,
  companyId: string,
  from: string,
  to: string,
  o: { notify?: boolean; runDate?: string; now?: Date } = {},
): Promise<EvalResult> {
  const now = o.now ?? new Date();
  const res: EvalResult = {
    evaluated: 0,
    created: 0,
    updated: 0,
    autoResolved: 0,
    reopened: 0,
    notified: 0,
  };
  const rules = new Map((await effectiveRules(tx)).map((r) => [r.code, r]));
  const on = (c: ExceptionRuleCode) => rules.get(c)!.enabled;
  const thr = (c: ExceptionRuleCode) => rules.get(c)!.threshold ?? 0;
  const [co] = await rows<{ tz: string; radius: number; off: number[] | null }>(
    tx,
    sql`select c.timezone as tz, c.default_geofence_m as radius,
               (select weekly_off_days from leave_settings ls where ls.company_id = c.id and ls.deleted_at is null limit 1) as off
        from companies c where c.id = ${companyId}`,
  );
  if (!co) return res;
  const weeklyOff = new Set(co.off ?? [0]);
  const dates = datesBetween(from, to);
  const lockRows = await rows<{ d: string; passed: boolean }>(
    tx,
    sql`select to_char(t::date, 'YYYY-MM-DD') as d,
               ((t::date + 1)::timestamp at time zone 'Asia/Kolkata') < ${now.toISOString()}::timestamptz as passed
        from generate_series(${from}::date, ${to}::date, interval '1 day') g(t)`,
  );
  const lockPassed = new Map(lockRows.map((r) => [r.d, r.passed]));

  const people = await rows<{ id: string; manager_id: string | null; joined: string | null }>(
    tx,
    sql`select u.id, u.manager_id, to_char(u.joined_on, 'YYYY-MM-DD') as joined from users u
        where u.status = 'active' and u.deleted_at is null
          and exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                      where ur.user_id = u.id and r.deleted_at is null and 'field:write' = any(r.permissions))`,
  );
  if (!people.length) return res;
  const ids = people.map((p) => p.id);
  const idList = sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  );

  const days = await rows<{
    user_id: string;
    d: string;
    kind: string;
    status: string;
    field_day: boolean;
    submitted: boolean;
    on_time: boolean;
    doctor_calls: number;
  }>(
    tx,
    sql`select user_id, to_char(date, 'YYYY-MM-DD') as d, work_type_kind::text as kind, status::text as status, field_day,
               dcr_submitted as submitted, dcr_on_time as on_time, doctor_calls::int as doctor_calls
        from kpi_user_day where user_id in (${idList}) and date between ${from}::date and ${to}::date`,
  );
  const dayBy = new Map(days.map((r) => [`${r.user_id}|${r.d}`, r]));
  const punches = await rows<{ user_id: string; d: string; at: string }>(
    tx,
    sql`select user_id, to_char((captured_at at time zone ${co.tz})::date, 'YYYY-MM-DD') as d, min(captured_at)::text as at
        from geo_captures where kind = 'punch_in' and user_id in (${idList})
          and (captured_at at time zone ${co.tz})::date between ${from}::date and ${to}::date
        group by 1, 2`,
  );
  const punchBy = new Map(punches.map((r) => [`${r.user_id}|${r.d}`, r.at]));
  const leaves = await rows<{ user_id: string; d: string; half: string | null }>(
    tx,
    sql`select user_id, to_char(date, 'YYYY-MM-DD') as d, half from kpi_user_leave_day
        where user_id in (${idList}) and date between ${from}::date and ${to}::date`,
  );
  const fullLeave = new Set(leaves.filter((l) => !l.half).map((l) => `${l.user_id}|${l.d}`));
  const fences = await rows<{
    user_id: string;
    d: string;
    visits: number;
    out: number;
    mock: number;
    bad: number;
  }>(
    tx,
    sql`select g.user_id, to_char((g.captured_at at time zone ${co.tz})::date, 'YYYY-MM-DD') as d,
               count(*)::int as visits,
               count(*) filter (where g.distance_m is not null
                 and g.distance_m > coalesce(doc.geofence_radius_m, ${co.radius}))::int as out,
               count(*) filter (where g.is_mock)::int as mock,
               count(*) filter (where g.is_mock or (g.distance_m is not null
                 and g.distance_m > coalesce(doc.geofence_radius_m, ${co.radius})))::int as bad
        from geo_captures g left join doctors doc on doc.id = g.entity_id
        where g.kind = 'visit' and g.user_id in (${idList})
          and (g.captured_at at time zone ${co.tz})::date between ${from}::date and ${to}::date
        group by 1, 2`,
  );
  const fenceBy = new Map(fences.map((r) => [`${r.user_id}|${r.d}`, r]));

  const evaluated = new Set<Key>();
  const hits = new Map<Key, Hit>();
  const check = (u: string, r: ExceptionRuleCode, d: string, hit: Hit | null) => {
    if (!on(r)) return;
    evaluated.add(key(u, r, d));
    if (hit) hits.set(key(u, r, d), hit);
  };

  for (const p of people) {
    for (const d of dates) {
      if (p.joined && d < p.joined) continue;
      const k = `${p.id}|${d}`;
      const day = dayBy.get(k);
      const punch = punchBy.get(k) ?? null;
      const working = !weeklyOff.has(new Date(ms(d)).getUTCDay()) && !fullLeave.has(k);
      const offDcr = day?.kind === 'leave' || day?.kind === 'holiday';
      const submitted = !!day?.submitted;
      const locked = !!lockPassed.get(d);
      const missingNow = working && !offDcr && locked && !submitted;
      if (locked || submitted) {
        check(
          p.id,
          'dcr_missing',
          d,
          missingNow && !punch
            ? { value: null, context: { dcrStatus: day?.status ?? null } }
            : null,
        );
        check(
          p.id,
          'punch_without_dcr',
          d,
          missingNow && punch
            ? { value: null, context: { punchInAt: punch, dcrStatus: day?.status ?? null } }
            : null,
        );
      }
      check(p.id, 'dcr_late', d, submitted && !day!.on_time ? { value: null, context: {} } : null);
      const minCalls = thr('low_call_average');
      check(
        p.id,
        'low_call_average',
        d,
        submitted && day!.field_day && day!.doctor_calls < minCalls
          ? { value: day!.doctor_calls, context: { doctorCalls: day!.doctor_calls } }
          : null,
      );
      check(
        p.id,
        'no_punch_in',
        d,
        working && !offDcr && !punch && !missingNow ? { value: null, context: {} } : null,
      );
      const f = fenceBy.get(k);
      const bad = f?.bad ?? 0;
      check(
        p.id,
        'geofence_breach',
        d,
        f && bad >= Math.max(thr('geofence_breach'), 1)
          ? { value: bad, context: { visits: f.visits, outOfFence: f.out, mockLocation: f.mock } }
          : null,
      );
    }
  }

  // tp_not_submitted: dates on/after the deadline day -> next month's plan.
  const tpDay = thr('tp_not_submitted');
  const tpMonths = [
    ...new Set(dates.filter((d) => Number(d.slice(8)) >= tpDay).map((d) => nextMonth(d))),
  ];
  if (on('tp_not_submitted') && tpMonths.length) {
    const plans = await rows<{ user_id: string; m: string; status: string }>(
      tx,
      // #86: a month with any pending or approved submission counts as submitted.
      sql`select user_id, to_char(month, 'YYYY-MM-DD') as m,
            case when exists (select 1 from tour_plan_submissions ts where ts.tour_plan_id = tour_plans.id
              and ts.deleted_at is null and ts.status in ('submitted', 'approved')) then 'submitted'
            else status::text end as status from tour_plans
          where deleted_at is null and user_id in (${idList})
            and month in (${sql.join(
              tpMonths.map((m) => sql`${m}::date`),
              sql`, `,
            )})`,
    );
    const planBy = new Map(plans.map((r) => [`${r.user_id}|${r.m}`, r.status]));
    for (const p of people)
      for (const m of tpMonths) {
        if (p.joined && addDays(m, -1) < p.joined) continue;
        const st = planBy.get(`${p.id}|${m}`) ?? null;
        check(
          p.id,
          'tp_not_submitted',
          m,
          st === 'submitted' || st === 'approved'
            ? null
            : { value: null, context: { month: m.slice(0, 7), planStatus: st } },
        );
      }
  }

  // coverage_gap: months whose last day is in the window.
  const covMonths = dates.filter(isMonthEnd).map(monthStart);
  if (on('coverage_gap') && covMonths.length) {
    const cov = await rows<{ user_id: string; m: string; listed: number; missed: number }>(
      tx,
      sql`select user_id, to_char(month, 'YYYY-MM-DD') as m, count(*)::int as listed,
                 count(*) filter (where not frequency_met)::int as missed
          from kpi_user_doctor_month where user_id in (${idList})
            and month in (${sql.join(
              covMonths.map((m) => sql`${m}::date`),
              sql`, `,
            )})
          group by 1, 2`,
    );
    const covBy = new Map(cov.map((r) => [`${r.user_id}|${r.m}`, r]));
    for (const p of people)
      for (const m of covMonths) {
        if (p.joined && p.joined > m) continue;
        const c = covBy.get(`${p.id}|${m}`);
        const pct = c && c.listed ? Math.round((c.missed / c.listed) * 10000) / 100 : null;
        check(
          p.id,
          'coverage_gap',
          m,
          pct !== null && pct > thr('coverage_gap')
            ? { value: pct, context: { listedDoctors: c!.listed, missedDoctors: c!.missed } }
            : null,
        );
      }
  }
  res.evaluated = evaluated.size;

  // Upsert.
  const periods = [...evaluated].map((k) => k.split('|')[2]!);
  if (!periods.length) return res;
  const minP = periods.reduce((a, b) => (a < b ? a : b));
  const maxP = periods.reduce((a, b) => (a > b ? a : b));
  const existing = await tx
    .select()
    .from(exceptions)
    .where(and(inArray(exceptions.userId, ids), between(exceptions.periodDate, minP, maxP)));
  const exBy = new Map(
    existing.map((e) => [key(e.userId, e.ruleCode as ExceptionRuleCode, e.periodDate), e]),
  );
  const mgr = new Map(people.map((p) => [p.id, p.manager_id]));
  const fresh: { userId: string; severity: ExceptionSeverity }[] = [];
  const nowTs = new Date();
  for (const k of evaluated) {
    const [userId, rc, periodDate] = k.split('|') as [string, ExceptionRuleCode, string];
    const rule = rules.get(rc)!;
    const hit = hits.get(k);
    const ex = exBy.get(k);
    const threshold = rule.threshold;
    if (hit && !ex) {
      const ins = await tx
        .insert(exceptions)
        .values({
          id: uuidv7(),
          companyId,
          userId,
          ruleCode: rc,
          periodDate,
          severity: rule.severity,
          value: hit.value === null ? null : String(hit.value),
          threshold: threshold === null ? null : String(threshold),
          context: hit.context,
          assigneeId: mgr.get(userId) ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: exceptions.id });
      if (ins.length) {
        res.created++;
        fresh.push({ userId, severity: rule.severity });
      }
    } else if (hit && ex) {
      const open = ex.status === 'open' || ex.status === 'acknowledged';
      const reopen = ex.status === 'resolved' && ex.autoResolved;
      if (!open && !reopen) continue;
      const value = hit.value === null ? null : Number(hit.value).toFixed(2);
      const thrS = threshold === null ? null : Number(threshold).toFixed(2);
      const same =
        !reopen &&
        ex.severity === rule.severity &&
        ex.value === value &&
        ex.threshold === thrS &&
        stable(ex.context ?? {}) === stable(hit.context);
      if (same) continue;
      await tx
        .update(exceptions)
        .set({
          severity: rule.severity,
          value,
          threshold: thrS,
          context: hit.context,
          ...(reopen
            ? { status: 'open' as const, autoResolved: false, resolvedAt: null, resolvedBy: null }
            : {}),
        })
        .where(eq(exceptions.id, ex.id));
      if (reopen) res.reopened++;
      else res.updated++;
    } else if (!hit && ex && (ex.status === 'open' || ex.status === 'acknowledged')) {
      await tx
        .update(exceptions)
        .set({ status: 'resolved', autoResolved: true, resolvedAt: nowTs, resolvedBy: null })
        .where(eq(exceptions.id, ex.id));
      res.autoResolved++;
    }
  }

  // Digest: one notification per direct manager per run day.
  if (o.notify && fresh.length) {
    const byMgr = new Map<string, { total: number; high: number; medium: number; low: number }>();
    for (const f of fresh) {
      const m = mgr.get(f.userId);
      if (!m) continue;
      const c = byMgr.get(m) ?? { total: 0, high: 0, medium: 0, low: 0 };
      c.total++;
      c[f.severity]++;
      byMgr.set(m, c);
    }
    const runDate = o.runDate ?? addDays(to, 1);
    for (const [userId, c] of byMgr) {
      const data = { ...c, from, to, runDate };
      const { title, body } = render('exceptions.digest', data);
      // No RETURNING: the notifications SELECT policy is own-rows only and the job has no user.
      await tx
        .insert(notifications)
        .values({
          id: uuidv7(),
          companyId,
          userId,
          type: 'exceptions.digest',
          title,
          body,
          entityType: null,
          entityId: null,
          data,
          dedupeKey: `exceptions:${runDate}`,
        })
        .onConflictDoNothing();
      res.notified++;
    }
  }
  return res;
}

/** TeamProfile.exceptions (#75 + #56) for one person. */
export async function profileExceptions(tx: Tx, userId: string, today: string) {
  const since = addDays(today, -29);
  const [t] = await rows<{ open: number; open_high: number; last30: number }>(
    tx,
    sql`select count(*) filter (where status in ('open','acknowledged'))::int as open,
               count(*) filter (where status in ('open','acknowledged') and severity = 'high')::int as open_high,
               count(*) filter (where period_date between ${since}::date and ${today}::date)::int as last30
        from exceptions where user_id = ${userId} and deleted_at is null`,
  );
  const by = await rows<{ rule_code: ExceptionRuleCode; n: number }>(
    tx,
    sql`select rule_code, count(*)::int as n from exceptions
        where user_id = ${userId} and deleted_at is null and period_date between ${since}::date and ${today}::date
        group by 1 order by 2 desc, 1`,
  );
  return {
    open: t?.open ?? 0,
    openHigh: t?.open_high ?? 0,
    last30Days: t?.last30 ?? 0,
    byRule: by.map((r) => ({ ruleCode: r.rule_code, count: r.n })),
  };
}
