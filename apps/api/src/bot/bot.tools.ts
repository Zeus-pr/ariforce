import { HttpException, Injectable } from '@nestjs/common';
import {
  KPI_KEYS,
  KpiQuery,
  ROLE_NAMES,
  type KpiKey,
  type KpiReport,
  type ProductKpiReport,
} from '@ariforce/contracts';
import { territories } from '@ariforce/db';
import { and, isNull, sql } from 'drizzle-orm';
import type * as z from 'zod';
import type { Principal } from '../auth/principal';
import { TenantService } from '../common/tenant.service';
import { KpisService } from '../kpis/kpis.service';
import { TeamService } from '../team/team.service';
import { BotRecords } from './bot.records';
import { choosePlace, periodArg, type ToolOutcome } from './run';

const DEFAULT_KPIS: KpiKey[] = [
  'coverage_pct',
  'call_average',
  'dcr_compliance_pct',
  'tp_adherence_pct',
  'primary_sales_value',
  'secondary_sales_value',
  'pob_value',
];

const KPI_LABEL: Record<string, string> = {
  coverage_pct: 'Coverage',
  call_average: 'Call average',
  chemist_call_average: 'Chemist call average',
  frequency_compliance_pct: 'Frequency',
  missed_doctor_pct: 'Missed doctors',
  unique_doctors_seen: 'Doctors seen',
  doctor_visits_per_day: 'Visits per day',
  dcr_compliance_pct: 'DCR compliance',
  dcr_on_time_pct: 'DCR on time',
  tp_adherence_pct: 'Tour plan adherence',
  msl_size: 'MSL',
  pob_value: 'POB',
  pob_achievement_pct: 'POB %',
  primary_sales_value: 'Primary',
  primary_achievement_pct: 'Primary %',
  secondary_sales_value: 'Secondary',
  secondary_achievement_pct: 'Secondary %',
  growth_vs_ly_pct: 'Growth vs last year',
};

const SALES_KPIS: KpiKey[] = [
  'primary_sales_value',
  'primary_achievement_pct',
  'secondary_sales_value',
  'secondary_achievement_pct',
];

const WITH_TARGET = new Set<KpiKey>(['primary_sales_value', 'secondary_sales_value', 'pob_value']);

const outside = (): ToolOutcome => ({
  model: { error: 'That is outside your team.' },
  block: null,
});

function failed(e: unknown): ToolOutcome {
  const status = e instanceof HttpException ? e.getStatus() : 0;
  if (status === 403 || status === 404) return outside();
  return { model: { error: 'That query could not be run.' }, block: null };
}

function figure(value: number | null, unit: string) {
  if (value === null) return '—';
  return unit === 'percent' ? `${value}%` : String(value);
}

function asFacts(
  title: string,
  columns: string[],
  rows: string[][],
  extra?: Record<string, unknown>,
): ToolOutcome {
  const shown = rows.slice(0, 12);
  const facts = shown.map((row) => {
    const fact: Record<string, string> = {};
    columns.forEach((column, index) => {
      fact[column] = row[index] ?? '';
    });
    return fact;
  });
  return {
    block: null,
    model: {
      title,
      facts,
      ...(rows.length > shown.length
        ? { note: `${rows.length} rows. Say the pattern and only the few that matter.` }
        : {}),
      ...extra,
    },
  };
}

function indiaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function expandKpis(keys: KpiKey[]): KpiKey[] {
  const set = new Set(keys);
  if (set.has('primary_sales_value') || set.has('primary_achievement_pct')) {
    set.add('primary_sales_value');
    set.add('primary_achievement_pct');
  }
  if (set.has('secondary_sales_value') || set.has('secondary_achievement_pct')) {
    set.add('secondary_sales_value');
    set.add('secondary_achievement_pct');
  }
  const rest = [...set].filter((key) => !SALES_KPIS.includes(key));
  return [...SALES_KPIS.filter((key) => set.has(key)), ...rest];
}

function kpiTable(report: KpiReport) {
  const keys: KpiKey[] = [];
  for (const row of report.rows)
    for (const metric of row.metrics) if (!keys.includes(metric.kpi)) keys.push(metric.kpi);
  const lead = report.rollup === 'byTerritory' ? 'Place' : 'Who';
  const columns = [lead];
  for (const key of keys) {
    columns.push(KPI_LABEL[key] ?? key);
    if (WITH_TARGET.has(key)) columns.push(`${KPI_LABEL[key] ?? key} target`);
  }
  const rows = report.rows.map((row) => {
    const cells = [row.label];
    for (const key of keys) {
      const metric = row.metrics.find((item) => item.kpi === key);
      cells.push(metric ? figure(metric.value, metric.unit) : '—');
      if (WITH_TARGET.has(key))
        cells.push(metric?.target == null ? '—' : figure(metric.target, metric.unit));
    }
    return cells;
  });
  return { columns, rows };
}

@Injectable()
export class BotTools {
  constructor(
    private readonly team: TeamService,
    private readonly kpis: KpisService,
    private readonly tenant: TenantService,
    private readonly records: BotRecords,
  ) {}

  async call(
    p: Principal,
    companyWide: boolean,
    name: string,
    args: unknown,
  ): Promise<ToolOutcome> {
    try {
      if (name === 'list_team') return await this.listTeam(p, args);
      if (name === 'kpi_report') return await this.kpisFor(p, companyWide, args);
      if (name === 'product_kpis') return await this.productsFor(p, companyWide, args);
      if (name === 'read_records') return await this.records.read(p, args);
      return { model: { error: 'Unknown tool.' }, block: null };
    } catch (e) {
      return failed(e);
    }
  }

  private async listTeam(p: Principal, args: unknown): Promise<ToolOutcome> {
    const name = typeof args === 'object' && args && 'name' in args ? String(args.name ?? '') : '';
    const needle = name.trim().toLowerCase();
    const tree = await this.team.tree(p);
    const allowed = p.teamUserIds ? new Set(p.teamUserIds) : null;
    const all = [...tree.nodes, ...tree.unassigned].filter(
      (n) => !allowed || n.depth < 0 || allowed.has(n.id),
    );
    const matched = needle ? all.filter((n) => n.name.toLowerCase().includes(needle)) : all;
    const shown = matched.slice(0, 40);
    const columns = ['Name', 'Role', 'Territory'];
    const rows = shown.map((n) => [
      n.name,
      n.role ? ROLE_NAMES[n.role] : '',
      n.territories.map((t) => t.name).join(', '),
    ]);
    return asFacts('Team', columns, rows, {
      people: shown.map((n) => ({
        id: n.id,
        name: n.name,
        role: n.role ? ROLE_NAMES[n.role] : '',
        territory: n.territories.map((t) => t.name).join(', '),
        unassigned: n.depth < 0,
      })),
      ...(matched.length > shown.length ? { note: `Showing 40 of ${matched.length}.` } : {}),
      ...(matched.length === 0
        ? {
            note: 'No person on this line matches that name. A headquarters is a place: call kpi_report with place. A stockist statement is on AWS & SS, not a person.',
          }
        : {}),
    });
  }

  private async places(p: Principal, name: string) {
    const needle = name.trim().toLowerCase().replace(/[%_]/g, '');
    if (!needle) return [];
    return this.tenant.run(p, async (tx) => {
      const rows = await tx
        .select({ id: territories.id, name: territories.name, level: territories.level })
        .from(territories)
        .where(
          and(
            isNull(territories.deletedAt),
            sql`strpos(lower(${territories.name}), ${needle}) > 0`,
            this.tenant.scope(p, territories.path),
          ),
        );
      return rows;
    });
  }

  private query(
    args: unknown,
    companyWide: boolean,
  ): { error: ToolOutcome } | { data: z.output<typeof KpiQuery> } {
    const raw = (typeof args === 'object' && args ? args : {}) as Record<string, unknown>;
    const requested = Array.isArray(raw.kpis)
      ? raw.kpis.filter((k): k is KpiKey => (KPI_KEYS as readonly string[]).includes(String(k)))
      : [];
    const span = periodArg(raw.month, indiaToday());
    const parsed = KpiQuery.safeParse({
      month: span.month,
      from: span.from,
      to: span.to,
      userId: raw.userId,
      rollup: raw.rollup ?? (raw.userId ? 'self' : 'team'),
      territoryId: raw.territoryId,
      kpis: expandKpis(requested.length ? requested : [...DEFAULT_KPIS]),
    });
    if (!parsed.success)
      return {
        error: {
          model: { error: 'Use a month as YYYY-MM and a userId from list_team.' },
          block: null,
        },
      };
    if (parsed.data.rollup === 'company' && !companyWide) return { error: outside() };
    return { data: parsed.data };
  }

  private async kpisFor(p: Principal, companyWide: boolean, args: unknown): Promise<ToolOutcome> {
    const raw = (
      typeof args === 'object' && args ? { ...(args as Record<string, unknown>) } : {}
    ) as Record<string, unknown>;
    const place = typeof raw.place === 'string' ? raw.place.trim() : '';
    if (place) {
      const found = await this.places(p, place);
      if (found.length === 0)
        return {
          model: {
            error:
              'No place on this line matches that name. If it is a person, call list_team. A stockist is not a headquarters.',
          },
          block: null,
        };
      const placeRow = choosePlace(found, place);
      if (!placeRow)
        return asFacts(
          'Places',
          ['Place', 'Level'],
          found.slice(0, 40).map((row) => [row.name, row.level]),
          { note: 'More than one different place matches. Ask again with the full name.' },
        );
      raw.territoryId = placeRow.id;
      raw.rollup = 'byTerritory';
      const asked = Array.isArray(raw.kpis) ? raw.kpis.map(String) : [];
      const sales = asked.some((key) => key.startsWith('primary_') || key.startsWith('secondary_'));
      if (!asked.length || sales) raw.kpis = [...SALES_KPIS];
    }
    const q = this.query(raw, companyWide);
    if (!('data' in q)) return q.error;
    if (q.data.userId && p.teamUserIds && !p.teamUserIds.includes(q.data.userId)) return outside();
    const report: KpiReport = await this.kpis.report(p, q.data as z.output<typeof KpiQuery>);
    const only = typeof raw.territoryId === 'string' ? raw.territoryId : '';
    const scoped = only ? report.rows.filter((row) => row.territoryId === only) : report.rows;
    const table = kpiTable({ ...report, rows: scoped.length ? scoped : report.rows });
    if (!table.rows.length) return { model: { error: 'No figures for that month.' }, block: null };
    return asFacts(`KPIs ${report.from} to ${report.to}`, table.columns, table.rows);
  }

  private async productsFor(
    p: Principal,
    companyWide: boolean,
    args: unknown,
  ): Promise<ToolOutcome> {
    const q = this.query(args, companyWide);
    if (!('data' in q)) return q.error;
    if (q.data.userId && p.teamUserIds && !p.teamUserIds.includes(q.data.userId)) return outside();
    const report: ProductKpiReport = await this.kpis.products(
      p,
      q.data as z.output<typeof KpiQuery>,
    );
    const rows = report.rows.map((r) => [
      r.productName,
      String(r.detailedCalls),
      String(r.firstPositionCalls),
      r.detailingSharePct == null ? '—' : `${r.detailingSharePct}%`,
      String(r.sampleQty),
      String(r.pobQty),
      String(r.pobValue),
    ]);
    return asFacts(
      `Products ${report.from} to ${report.to}`,
      ['Product', 'Detailed', 'First position', 'Share', 'Samples', 'POB qty', 'POB'],
      rows,
    );
  }
}
