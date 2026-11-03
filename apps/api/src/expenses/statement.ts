import type { ExpenseCategory } from '@ariforce/contracts';

export interface StatementHeader {
  userName: string;
  employeeCode: string | null;
  designation: string | null;
  region: string | null;
  hq: string | null;
  division: string | null;
  joinedOn: string | null;
  managerName: string | null;
  managerCode: string | null;
  phone: string | null;
  email: string | null;
  company: string;
  status: string;
}

export interface StatementDcr {
  date: string;
  workTypeName: string;
  workTypeKind: 'field' | 'non_field' | 'leave' | 'holiday';
  status: string;
  band: 'hq' | 'ex_hq' | 'outstation' | null;
  places: string[];
  routes: string[];
  distanceKm: number;
  doctorsMet: number;
  accompanists: number;
}

export interface StatementLine {
  date: string;
  category: ExpenseCategory;
  amount: number;
  notes: string | null;
  mileageKm: number | null;
}

export interface StatementInput {
  month: string;
  header: StatementHeader;
  dcrs: StatementDcr[];
  lines: StatementLine[];
  leaves: { from: string; to: string; policy: string }[];
  weeklyOffDays: number[];
}

export const MONEY_COLUMNS = [
  'ta',
  'da',
  'additional',
  'courier',
  'mobile',
  'teamMeeting',
  'other',
] as const;
export type MoneyColumn = (typeof MONEY_COLUMNS)[number];

const COLUMN_OF: Record<ExpenseCategory, MoneyColumn> = {
  travel: 'ta',
  mileage: 'ta',
  allowance: 'da',
  additional_ta_da: 'additional',
  courier: 'courier',
  mobile: 'mobile',
  team_meeting: 'teamMeeting',
  hotel: 'other',
  food: 'other',
  other: 'other',
};

export interface StatementRow {
  date: string;
  activity: string;
  dcrStatus: string;
  category: string;
  workPlace: string;
  route: string;
  distance: number;
  doctorsMet: number;
  accompanists: number;
  money: Record<MoneyColumn, number>;
  total: number;
  remarks: string;
}

const BAND_LABEL = { hq: 'HQ', ex_hq: 'EX HQ', outstation: 'OUTSTATION' } as const;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATUS_LABEL: Record<string, string> = {
  draft: 'Not Applied',
  submitted: 'Claim Applied',
  approved: 'Approved',
  rejected: 'Rejected',
  paid: 'Paid',
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const emptyMoney = (): Record<MoneyColumn, number> => ({
  ta: 0,
  da: 0,
  additional: 0,
  courier: 0,
  mobile: 0,
  teamMeeting: 0,
  other: 0,
});

export const claimStatusLabel = (s: string) => STATUS_LABEL[s] ?? s;

function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/**
 * One row per calendar day (more per day when several reports exist). The day's expense lines sit
 * on the first row of the day so the column totals never double count.
 */
export function buildStatementRows(input: StatementInput): StatementRow[] {
  const rows: StatementRow[] = [];
  for (const date of daysOfMonth(input.month)) {
    const reports = input.dcrs.filter((d) => d.date === date);
    const base = (): StatementRow => ({
      date,
      activity: '-',
      dcrStatus: '-',
      category: '-',
      workPlace: '-',
      route: '-',
      distance: 0,
      doctorsMet: 0,
      accompanists: 0,
      money: emptyMoney(),
      total: 0,
      remarks: '',
    });
    const dayRows: StatementRow[] = reports.map((d) => {
      const r = base();
      r.activity = d.workTypeKind === 'field' ? 'Field' : d.workTypeName;
      r.dcrStatus = d.status.charAt(0).toUpperCase() + d.status.slice(1);
      r.category = d.band ? BAND_LABEL[d.band] : '-';
      r.workPlace = d.places.join(', ') || '-';
      r.route = d.routes.join('; ') || '-';
      r.distance = d.distanceKm;
      r.doctorsMet = d.doctorsMet;
      r.accompanists = d.accompanists;
      return r;
    });
    if (!dayRows.length) {
      const r = base();
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const leave = input.leaves.find((l) => l.from <= date && date <= l.to);
      if (leave) r.activity = `Leave (${leave.policy})`;
      else if (input.weeklyOffDays.includes(dow)) r.activity = DAY_NAMES[dow]!;
      dayRows.push(r);
    }
    const lines = input.lines.filter((l) => l.date === date);
    const first = dayRows[0]!;
    for (const l of lines) {
      first.money[COLUMN_OF[l.category]] = r2(first.money[COLUMN_OF[l.category]] + l.amount);
      first.total = r2(first.total + l.amount);
      if (first.distance === 0 && l.mileageKm) first.distance = l.mileageKm;
    }
    first.remarks = lines
      .map((l) => l.notes?.trim())
      .filter(Boolean)
      .join(', ');
    rows.push(...dayRows);
  }
  return rows;
}

export function statementTotals(rows: StatementRow[]) {
  const money = emptyMoney();
  let distance = 0;
  let doctorsMet = 0;
  let accompanists = 0;
  let total = 0;
  for (const r of rows) {
    for (const k of MONEY_COLUMNS) money[k] = r2(money[k] + r.money[k]);
    distance = r2(distance + r.distance);
    doctorsMet += r.doctorsMet;
    accompanists += r.accompanists;
    total = r2(total + r.total);
  }
  return { money, distance, doctorsMet, accompanists, total };
}
