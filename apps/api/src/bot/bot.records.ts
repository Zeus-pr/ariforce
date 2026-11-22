import { HttpException, Injectable } from '@nestjs/common';
import { MastersService } from '../masters/masters.service';
import { MASTERS } from '../masters/master-defs';
import { DcrService } from '../dcr/dcr.service';
import { TourPlansService } from '../plans/tour-plans.service';
import { ApprovalsService } from '../plans/approvals.service';
import { LeaveService } from '../leave/leave.service';
import { ExpensesService } from '../expenses/expenses.service';
import { StockStatementsService } from '../stock-statements/stock-statements.service';
import { ExceptionsService } from '../exceptions/exceptions.service';
import { HolidaysService } from '../leave/holidays.service';
import { SfcService } from '../sfc/sfc.service';
import type { Principal } from '../auth/principal';
import { periodArg, type ToolOutcome } from './run';

const KINDS = [
  'doctors',
  'chemists',
  'stockists',
  'dcrs',
  'tour_plans',
  'leave',
  'leave_balances',
  'expenses',
  'approvals',
  'stock_statements',
  'exceptions',
  'holidays',
  'sfc',
] as const;

type Kind = (typeof KINDS)[number];

const HIDDEN = /email|phone|password|token|secret|auth/i;

function indiaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function itemsOf(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const bag = data as { items?: unknown; data?: unknown };
  if (Array.isArray(bag.items)) return bag.items;
  if (Array.isArray(bag.data)) return bag.data;
  return [data];
}

function textOf(item: unknown): string | null {
  if (item == null || typeof item === 'object') {
    if (item && typeof item === 'object' && 'name' in item && typeof item.name === 'string')
      return item.name;
    return null;
  }
  const text = String(item);
  if (!text) return null;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function cells(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (HIDDEN.test(key)) continue;
    const text = textOf(item);
    if (text) out[key] = text;
  }
  return out;
}

function table(title: string, data: unknown): ToolOutcome {
  const rows = itemsOf(data).slice(0, 40).map(cells);
  const preferred = [
    'name',
    'status',
    'month',
    'date',
    'from',
    'to',
    'typeName',
    'amount',
    'value',
  ];
  const keys = [
    ...preferred.filter((key) => rows.some((row) => key in row)),
    ...[...new Set(rows.flatMap((row) => Object.keys(row)))].filter(
      (key) => !preferred.includes(key),
    ),
  ].slice(0, 6);
  const body = rows.map((row) => keys.map((key) => row[key] ?? ''));
  return {
    block: body.length ? { type: 'table', title, columns: keys, rows: body } : null,
    model: {
      title,
      columns: keys,
      rows: body,
      ...(body.length ? {} : { note: 'Nothing on this account matches.' }),
    },
  };
}

@Injectable()
export class BotRecords {
  constructor(
    private readonly masters: MastersService,
    private readonly dcrs: DcrService,
    private readonly plans: TourPlansService,
    private readonly leave: LeaveService,
    private readonly expenses: ExpensesService,
    private readonly approvals: ApprovalsService,
    private readonly stock: StockStatementsService,
    private readonly exceptions: ExceptionsService,
    private readonly holidays: HolidaysService,
    private readonly sfc: SfcService,
  ) {}

  async read(p: Principal, args: unknown): Promise<ToolOutcome> {
    const raw = (typeof args === 'object' && args ? args : {}) as Record<string, unknown>;
    const kind = String(raw.kind ?? '');
    if (!KINDS.includes(kind as Kind))
      return { model: { error: 'Unknown record kind.' }, block: null };
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const userId = typeof raw.userId === 'string' ? raw.userId : undefined;
    const span = periodArg(raw.month, indiaToday());
    try {
      return table(kind, await this.fetch(p, kind as Kind, name, userId, span));
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 0;
      if (status === 403 || status === 404)
        return { model: { error: 'That is not on your account.' }, block: null };
      return { model: { error: 'That could not be read.' }, block: null };
    }
  }

  private fetch(
    p: Principal,
    kind: Kind,
    name: string,
    userId: string | undefined,
    span: { month?: string; from?: string; to?: string },
  ) {
    const month = span.month;
    const from = span.from ?? (month ? `${month}-01` : undefined);
    const to = span.to;
    if (kind === 'doctors' || kind === 'chemists' || kind === 'stockists')
      return this.masters.list(MASTERS[kind]!, p, { q: name || undefined, limit: 40 } as never);
    if (kind === 'dcrs') return this.dcrs.list(p, { from, to, userId, limit: 40 } as never);
    if (kind === 'tour_plans') return this.plans.list(p, { month, userId, limit: 40 } as never);
    if (kind === 'leave') return this.leave.list(p, { from, to, userId });
    if (kind === 'leave_balances')
      return this.leave.balances(p, {
        userId,
        year: month ? Number(month.slice(0, 4)) : undefined,
      });
    if (kind === 'expenses') return this.expenses.list(p, { month, userId, limit: 40 });
    if (kind === 'approvals') return this.approvals.list(p, { limit: 40 } as never);
    if (kind === 'stock_statements') return this.stock.list(p, {});
    if (kind === 'holidays') return this.holidays.list(p, { from, to });
    if (kind === 'sfc') return this.sfc.employees(p);
    return this.exceptions.list(p, {} as never);
  }
}
