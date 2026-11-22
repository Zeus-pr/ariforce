import { HttpException, Injectable } from '@nestjs/common';
import {
  KPI_KEYS,
  KpiQuery,
  ROLE_NAMES,
  type KpiKey,
  type KpiReport,
  type ProductKpiReport,
} from '@ariforce/contracts';
import type * as z from 'zod';
import type { Principal } from '../auth/principal';
import { KpisService } from '../kpis/kpis.service';
import { TeamService } from '../team/team.service';
import type { ToolOutcome } from './run';

const DEFAULT_KPIS: KpiKey[] = [
  'coverage_pct',
  'call_average',
  'dcr_compliance_pct',
  'tp_adherence_pct',
  'pob_value',
];

const KPI_LABEL: Record<string, string> = {
  coverage_pct: 'Coverage',
  call_average: 'Call average',
  chemist_call_average: 'Chemist call average',
  frequency_compliance_pct: 'Frequency',
  missed_doctor_pct: 'Missed doctors',
  unique_doctors_seen: 'Doctors seen',
  dcr_compliance_pct: 'DCR compliance',
  dcr_on_time_pct: 'DCR on time',
  tp_adherence_pct: 'Tour plan adherence',
  msl_size: 'MSL',
  pob_value: 'POB',
  primary_sales_value: 'Primary sales',
  primary_achievement_pct: 'Primary achievement',
  secondary_sales_value: 'Secondary sales',
  secondary_achievement_pct: 'Secondary achievement',
  growth_vs_ly_pct: 'Growth vs last year',
};

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

function asTable(
  title: string,
  columns: string[],
  rows: string[][],
  extra?: Record<string, unknown>,
): ToolOutcome {
  const shown = rows.slice(0, 40);
  return {
    block: { type: 'table', title, columns, rows: shown },
    model: {
      title,
      columns,
      rows: shown,
      ...(rows.length > shown.length ? { note: `Showing 40 of ${rows.length}.` } : {}),
      ...extra,
    },
  };
}

@Injectable()
export class BotTools {
  constructor(
    private readonly team: TeamService,
    private readonly kpis: KpisService,
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
    const columns = ['Name', 'Role', 'Territory', 'Line'];
    const rows = shown.map((n) => [
      n.name,
      n.role ? ROLE_NAMES[n.role] : '',
      n.territories.map((t) => t.name).join(', '),
      n.depth < 0 ? 'Unassigned' : 'Team',
    ]);
    return asTable('Team', columns, rows, {
      people: shown.map((n) => ({
        id: n.id,
        name: n.name,
        role: n.role ? ROLE_NAMES[n.role] : '',
      })),
      ...(matched.length > shown.length ? { note: `Showing 40 of ${matched.length}.` } : {}),
      ...(matched.length === 0 ? { note: 'No one on this team matches that name.' } : {}),
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
    const parsed = KpiQuery.safeParse({
      month: raw.month,
      userId: raw.userId,
      rollup: raw.rollup,
      kpis: requested.length ? requested : [...DEFAULT_KPIS],
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
    const q = this.query(args, companyWide);
    if (!('data' in q)) return q.error;
    if (q.data.userId && p.teamUserIds && !p.teamUserIds.includes(q.data.userId)) return outside();
    const report: KpiReport = await this.kpis.report(p, q.data as z.output<typeof KpiQuery>);
    const rows = report.rows.flatMap((row) =>
      row.metrics.map((m) => [row.label, KPI_LABEL[m.kpi] ?? m.kpi, figure(m.value, m.unit)]),
    );
    return asTable(`KPIs ${report.from} to ${report.to}`, ['Who', 'Measure', 'Value'], rows);
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
      String(r.sampleQty),
      String(r.pobValue),
    ]);
    return asTable(
      `Products ${report.from} to ${report.to}`,
      ['Product', 'Detailed', 'Samples', 'POB'],
      rows,
    );
  }
}
