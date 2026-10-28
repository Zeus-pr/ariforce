/**
 * ============================================================================================
 * PLACEHOLDER DATA. NOT FROM THE API.
 * ============================================================================================
 * Everything on the home screen except the signed-in user's name, company and role comes from
 * this file. Nothing is sent anywhere: punch in / punch out is local state only, and the GPS
 * line is a stub (no location is read). The screen shows a "Sample data" label while
 * HOME_IS_PLACEHOLDER is true.
 *
 * Wiring later: replace getHomeMock() with one TanStack Query hook per block, keyed by user and
 * date. Suggested sources (all existing AriForce features):
 *   attendance   punch in/out with GPS                         ['attendance', date]
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
};

export type HomeData = {
  attendance: { punchedInAt: Date | null; place: string };
  todayPlan: { workType: string; area: string; band: string; workWith: string | null };
  dcrToday: { submitted: boolean };
  attention: AttentionItem[];
  doctorsToday: PlannedDoctor[];
  approvals: { dcr: number; tourPlans: number; leave: number; expenses: number };
  kpis: Kpi[];
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
  return {
    attendance: { punchedInAt: at(now, 9, 12), place: 'Burdwan HQ' },
    todayPlan: { workType: 'Field work', area: 'Burdwan', band: 'HQ', workWith: 'Amit Das (ABM)' },
    dcrToday: { submitted: false },
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
    doctorsToday: [
      {
        id: 'd1',
        name: 'Dr. R Kartikeyan',
        speciality: 'Neuro Surgeon',
        area: 'Burdwan',
        metAt: at(now, 10, 30),
      },
      {
        id: 'd2',
        name: 'Dr. Arijit Ghosh',
        speciality: 'Orthopaedician',
        area: 'Burdwan',
        metAt: null,
      },
      {
        id: 'd3',
        name: 'Dr. Pratyay Mukherjee',
        speciality: 'Orthopaedician',
        area: 'Burdwan',
        metAt: null,
      },
      {
        id: 'd4',
        name: 'Dr. Satyarup Banerjee',
        speciality: 'Physician',
        area: 'Burdwan',
        metAt: null,
      },
    ],
    approvals: { dcr: 2, tourPlans: 1, leave: 1, expenses: 3 },
    kpis: [
      {
        key: 'call_average',
        label: 'Call average',
        value: '9.4',
        target: 'Target 10 a day',
        progress: 0.94,
      },
      {
        key: 'coverage_pct',
        label: 'Coverage',
        value: '62%',
        target: 'Target 90%',
        progress: 0.69,
      },
      {
        key: 'chemist_call_average',
        label: 'Chemist calls',
        value: '3.1',
        target: 'Target 4 a day',
        progress: 0.78,
      },
      {
        key: 'dcr_on_time_pct',
        label: 'DCR on time',
        value: '92%',
        target: 'Target 100%',
        progress: 0.92,
      },
    ],
  };
}
