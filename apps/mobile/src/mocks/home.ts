/**
 * ============================================================================================
 * PLACEHOLDER DATA. NOT FROM THE API.
 * ============================================================================================
 * Everything on the home screen except the signed-in user's name, company and role comes from
 * this file. Punch in/out on Home is live (lib/field); the canopy daily-target strip and most
 * cards below are still mock until wired.
 *
 * Wiring later: replace getHomeMock() with one TanStack Query hook per block, keyed by user and
 * date. Suggested sources (all existing AriForce features):
 *   attendance   punch in/out with GPS                         ['attendance', date]
 *   dailyTarget  planned calls today (tour plan / STP) vs done (DCR visits / check-ins)
 *                total = planned outlets for the day; done = distinct outlets checked in / called
 *                cluster / stp = territory / STP labels from the plan
 *   todayPlan    today's tour plan day (work type, area, work-with)  ['tour-plan', date]
 *   dcrToday     today's DCR status                             ['dcr', date]
 *   attention    exceptions for me (EXCEPTION_RULE_CODES)       ['exceptions', 'me']
 *   doctorsToday doctors planned today + calls already made     ['dcr', date, 'calls']
 *   approvals    pending approvals (approver roles only)        ['approvals', 'pending']
 *   kpis         KPI report, rollup 'self', this month          ['kpis', 'self', month]
 * ============================================================================================
 */
import type { ExceptionRuleCode, KpiKey } from '@ariforce/contracts';
import type { FeatureKey } from '@/lib/features';
import { formatDayMonth, monthName } from '@/lib/format';

export const HOME_IS_PLACEHOLDER = true;

export type AttentionItem = {
  id: string;
  code: ExceptionRuleCode;
  severity: 'high' | 'medium';
  title: string;
  detail: string;
  feature: FeatureKey;
};

export type PlannedDoctor = {
  id: string;
  name: string;
  speciality: string;
  area: string;
  /** Planned slot for Today's Schedule. */
  plannedAt: Date;
  /** null = planned, not yet called on. */
  metAt: Date | null;
};

export type Kpi = {
  key: KpiKey;
  label: string;
  value: string;
  target: string;
  /** 0..1, share of target reached. */
  progress: number;
  /** Optional delta chip e.g. "+0.2". */
  delta?: string;
};

export type HomeData = {
  attendance: { punchedInAt: Date | null; place: string };
  todayPlan: { workType: string; area: string; band: string; workWith: string | null };
  dcrToday: { submitted: boolean; dueBy: string };
  dailyTarget: { done: number; total: number; cluster: string; stp: string };
  attention: AttentionItem[];
  doctorsToday: PlannedDoctor[];
  approvals: { dcr: number; tourPlans: number; leave: number; expenses: number };
  kpis: Kpi[];
  offlineCache: { label: string };
  quickHints: {
    dcr: string;
    tourPlan: string;
    pob: string;
    expenses: string;
  };
};

const at = (day: Date, h: number, m: number) => {
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
};

const daysFrom = (day: Date, n: number) => {
  const d = new Date(day);
  d.setDate(d.getDate() + n);
  return d;
};

/** PLACEHOLDER: dates are relative to `now` so the sample stays believable on any day. */
export function getHomeMock(now: Date): HomeData {
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const doctorsToday: PlannedDoctor[] = [
    {
      id: 'd1',
      name: 'Dr. P. K. Banerjee',
      speciality: 'Paediatrics',
      area: 'Town North',
      plannedAt: at(now, 9, 30),
      metAt: at(now, 9, 45),
    },
    {
      id: 'd2',
      name: 'Ghosh Medical Stores',
      speciality: 'Chemist',
      area: 'Station Road Hub',
      plannedAt: at(now, 10, 15),
      metAt: at(now, 10, 40),
    },
    {
      id: 'd3',
      name: 'Dr. Debabrata Roy',
      speciality: 'Orthopaedic',
      area: 'Medicity Plaza',
      plannedAt: at(now, 14, 0),
      metAt: null,
    },
    {
      id: 'd4',
      name: 'Dr. Satyarup Banerjee',
      speciality: 'Physician',
      area: 'Burdwan',
      plannedAt: at(now, 16, 0),
      metAt: null,
    },
  ];
  const met = doctorsToday.filter((d) => d.metAt).length;
  return {
    attendance: { punchedInAt: at(now, 8, 30), place: 'Burdwan Cluster' },
    todayPlan: { workType: 'Field work', area: 'Burdwan', band: 'HQ', workWith: 'Amit Das (ABM)' },
    dcrToday: { submitted: false, dueBy: '18:00' },
    dailyTarget: {
      done: met,
      total: 10,
      cluster: 'Burdwan Cluster',
      stp: 'South Zone',
    },
    attention: [
      {
        id: 'dcr-missing',
        code: 'dcr_missing',
        severity: 'high',
        title: `DCR missing · ${formatDayMonth(daysFrom(now, -2))}`,
        detail: 'Submit it or request a correction',
        feature: 'dcr',
      },
      {
        id: 'tp-not-submitted',
        code: 'tp_not_submitted',
        severity: 'medium',
        title: `${monthName(nextMonth)} tour plan pending`,
        detail: 'Not submitted · due by the 1st',
        feature: 'tour-plan',
      },
    ],
    doctorsToday,
    approvals: { dcr: 2, tourPlans: 1, leave: 1, expenses: 3 },
    kpis: [
      {
        key: 'call_average',
        label: 'Call Avg',
        value: '10.2',
        target: 'Target: 10.0 calls',
        progress: 1.02,
        delta: '+0.2',
      },
      {
        key: 'coverage_pct',
        label: 'Coverage',
        value: '88%',
        target: '44 of 50 Target Drs',
        progress: 0.88,
      },
      {
        key: 'chemist_call_average',
        label: 'Chemist Calls',
        value: '3 / 4',
        target: 'Completed today',
        progress: 0.75,
      },
      {
        key: 'dcr_on_time_pct',
        label: 'DCR On-Time',
        value: '96%',
        target: 'Punctuality Score',
        progress: 0.96,
      },
    ],
    offlineCache: { label: '14 Doctor Profiles Cached Offline' },
    quickHints: {
      dcr: 'Due today by 18:00',
      tourPlan: 'STP Burdwan Hub',
      pob: 'Booking Desk (3 orders)',
      expenses: 'Claim & Allowance',
    },
  };
}
