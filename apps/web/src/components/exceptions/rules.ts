import type { Approval, AttendanceDay, CheckIn, Dcr, KpiReport, TourPlan } from '@ariforce/contracts';
import { formatKpi } from '@/components/dashboard/kpi-meta';
import { addDays, isWeekday, shortDate } from '@/lib/period';

export type Severity = 'high' | 'medium' | 'low';
export type Category = 'coverage' | 'calls' | 'dcr' | 'attendance' | 'geofence' | 'tour_plan' | 'approvals' | 'samples';

export type Exception = {
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  detail: string;
  who: string;
  userId: string | null;
  doctorId: string | null;
  date: string;
  /** Plain-language rule that raised it. */
  rule: string;
  /** Page holding the underlying record. */
  href: string;
  sample?: boolean;
};

export const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low'];
export const SEVERITY_LABEL: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low' };
export const SEVERITY_TEXT: Record<Severity, string> = {
  high: 'text-danger',
  medium: 'text-warning-text',
  low: 'text-muted-foreground',
};
export const CATEGORY_LABEL: Record<Category, string> = {
  coverage: 'Coverage',
  calls: 'Call average',
  dcr: 'DCR',
  attendance: 'Attendance',
  geofence: 'Geofence',
  tour_plan: 'Tour plan',
  approvals: 'Approvals',
  samples: 'Samples',
};

/**
 * Thresholds. Placeholders until Arighna confirms them (docs/kpi-definitions.md, CONTRACT-GAPS #15).
 * Every exception is a fixed rule over contract data; nothing here is predicted.
 */
export const THRESHOLDS = {
  missedDoctorHighPct: 30,
  coverageMinPct: 70,
  callAverageMin: 10,
  dcrComplianceMinPct: 90,
  dcrOnTimeMinPct: 80,
  tpAdherenceMinPct: 80,
  lateLogin: '09:30',
  tourPlanDueDay: 25,
  tourPlanWarnFromDay: 20,
  approvalStaleDays: 2,
};

const T = THRESHOLDS;

export function fromKpis(report: KpiReport | null, today: string): Exception[] {
  if (!report) return [];
  return report.rows.flatMap((r) => {
    const m = (k: string) => r.metrics.find((x) => x.kpi === k);
    const out: Exception[] = [];
    const base = { who: r.label, userId: r.userId, doctorId: null, date: today, href: '/' };
    const missed = m('missed_doctor_pct');
    if (missed?.value != null && missed.value >= T.missedDoctorHighPct)
      out.push({
        ...base,
        id: `kpi-missed-${r.label}`,
        severity: 'high',
        category: 'coverage',
        title: `${formatKpi(missed.value, 'percent')} of must-see doctors not visited`,
        detail: `${missed.numerator} of ${missed.denominator} MSL doctors have no visit this month.`,
        rule: `Missed doctors ≥ ${T.missedDoctorHighPct}% of MSL`,
      });
    const cov = m('coverage_pct');
    if (cov?.value != null && cov.value < T.coverageMinPct)
      out.push({
        ...base,
        id: `kpi-cov-${r.label}`,
        severity: 'medium',
        category: 'coverage',
        title: `Coverage ${formatKpi(cov.value, 'percent')}`,
        detail: `${cov.numerator} of ${cov.denominator} MSL doctors visited at least once.`,
        rule: `Coverage below ${T.coverageMinPct}%`,
      });
    const ca = m('call_average');
    if (ca?.value != null && ca.value < T.callAverageMin)
      out.push({
        ...base,
        id: `kpi-ca-${r.label}`,
        severity: 'medium',
        category: 'calls',
        title: `Call average ${formatKpi(ca.value, 'ratio')}`,
        detail: `${ca.numerator} doctor calls over ${ca.denominator} field days.`,
        rule: `Call average below ${T.callAverageMin} a day`,
      });
    const dcr = m('dcr_compliance_pct');
    if (dcr?.value != null && dcr.value < T.dcrComplianceMinPct)
      out.push({
        ...base,
        id: `kpi-dcr-${r.label}`,
        severity: 'medium',
        category: 'dcr',
        href: '/dcr',
        title: `DCR compliance ${formatKpi(dcr.value, 'percent')}`,
        detail: `${dcr.numerator} of ${dcr.denominator} expected working days have a DCR.`,
        rule: `DCR compliance below ${T.dcrComplianceMinPct}%`,
      });
    const ot = m('dcr_on_time_pct');
    if (ot?.value != null && ot.value < T.dcrOnTimeMinPct)
      out.push({
        ...base,
        id: `kpi-ot-${r.label}`,
        severity: 'low',
        category: 'dcr',
        href: '/dcr',
        title: `Only ${formatKpi(ot.value, 'percent')} of DCRs on time`,
        detail: `${ot.numerator} of ${ot.denominator} submitted DCRs were in by the end of the next day.`,
        rule: `DCR on time below ${T.dcrOnTimeMinPct}%`,
      });
    const tp = m('tp_adherence_pct');
    if (tp?.value != null && tp.value < T.tpAdherenceMinPct)
      out.push({
        ...base,
        id: `kpi-tp-${r.label}`,
        severity: 'low',
        category: 'tour_plan',
        href: '/tour-plans',
        title: `Tour plan adherence ${formatKpi(tp.value, 'percent')}`,
        detail: `${tp.numerator} of ${tp.denominator} planned visits had a matching call.`,
        rule: `Tour plan adherence below ${T.tpAdherenceMinPct}%`,
      });
    return out;
  });
}

const timeIST = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });

export function fromAttendance(days: AttendanceDay[], today: string): Exception[] {
  return days.flatMap((d): Exception[] => {
    const base = { who: d.userName, userId: d.userId, doctorId: null, date: d.date, href: '/attendance', category: 'attendance' as const };
    if (d.status === 'absent' && d.date === today)
      return [{ ...base, id: `att-abs-${d.userId}-${d.date}`, severity: 'high', title: 'No punch-in today', detail: 'No day start recorded and no leave applied.', rule: 'Working day with no punch-in' }];
    if (d.punchIn) {
      const t = timeIST.format(new Date(d.punchIn.capturedAt));
      if (t > T.lateLogin)
        return [{ ...base, id: `att-late-${d.userId}-${d.date}`, severity: 'medium', title: `Late punch-in at ${t} IST`, detail: `${shortDate(d.date)}. Expected by ${T.lateLogin} IST.`, rule: `Punch-in after ${T.lateLogin} IST` }];
    }
    return [];
  });
}

export function fromCheckIns(rows: CheckIn[], names: Map<string, string>, who: (userId: string) => string): Exception[] {
  return rows
    .filter((c) => c.kind === 'visit' && c.inFence === false)
    .map((c) => ({
      id: `geo-${c.id}`,
      severity: 'medium' as const,
      category: 'geofence' as const,
      title: `Visit ${c.distanceM != null ? `${(c.distanceM / 1000).toFixed(1)} km` : ''} outside the geofence`.replace('  ', ' '),
      detail: `${c.outletId ? (names.get(c.outletId) ?? 'Outlet') : 'Outlet'} · ${shortDate(c.date)} at ${timeIST.format(new Date(c.capturedAt))} IST`,
      who: who(c.userId),
      userId: c.userId,
      doctorId: c.outletKind === 'doctor' ? c.outletId : null,
      date: c.date,
      rule: 'Visit check-in outside the doctor’s geofence radius',
      href: '/attendance',
    }));
}

/** Weekdays from the 1st (or 7 days back) to yesterday with no submitted DCR. */
export function fromDcrs(dcrs: Dcr[], today: string, me: { id: string; name: string }): Exception[] {
  const done = new Set(dcrs.filter((d) => d.status !== 'draft').map((d) => d.date));
  const out: Exception[] = [];
  for (let i = 1; i <= 7; i++) {
    const day = addDays(today, -i);
    if (!isWeekday(day) || done.has(day)) continue;
    out.push({
      id: `dcr-miss-${day}`,
      severity: i <= 2 ? 'medium' : 'high',
      category: 'dcr',
      title: `DCR not submitted for ${shortDate(day)}`,
      detail: dcrs.some((d) => d.date === day) ? 'A draft exists but was not submitted.' : 'No DCR recorded for this working day.',
      who: me.name,
      userId: me.id,
      doctorId: null,
      date: day,
      rule: 'Working day (Mon–Sat) in the last 7 days without a submitted DCR; high after 2 days',
      href: '/dcr',
    });
  }
  return out;
}

export function fromTourPlan(next: TourPlan | null, nextMonth: string, today: string, me: { id: string; name: string }): Exception[] {
  const day = Number(today.slice(8, 10));
  if (day < T.tourPlanWarnFromDay) return [];
  if (next && (next.status === 'submitted' || next.status === 'approved')) return [];
  return [
    {
      id: `tp-${nextMonth}`,
      severity: day >= T.tourPlanDueDay ? 'high' : 'medium',
      category: 'tour_plan',
      title: `Tour plan for ${nextMonth} not submitted`,
      detail: next ? `Status: ${next.status}. Due by the ${T.tourPlanDueDay}th.` : `Not started. Due by the ${T.tourPlanDueDay}th.`,
      who: me.name,
      userId: me.id,
      doctorId: null,
      date: today,
      rule: `Next month’s plan not submitted from the ${T.tourPlanWarnFromDay}th; high from the ${T.tourPlanDueDay}th`,
      href: '/tour-plans',
    },
  ];
}

export function fromApprovals(rows: Approval[], today: string): Exception[] {
  return rows.flatMap((a) => {
    const age = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(a.createdAt.slice(0, 10) + 'T00:00:00Z')) / 864e5);
    if (age < T.approvalStaleDays) return [];
    return [
      {
        id: `appr-${a.id}`,
        severity: 'low' as const,
        category: 'approvals' as const,
        title: `Approval waiting ${age} days`,
        detail: a.summary,
        who: a.requestedByName,
        userId: a.requestedBy,
        doctorId: null,
        date: a.createdAt.slice(0, 10),
        rule: `Pending approval older than ${T.approvalStaleDays} days`,
        href: '/',
      },
    ];
  });
}

/** No contract covers sample stock yet (CONTRACT-GAPS #15). Shown with a "Sample data" badge. */
export const SAMPLE_EXCEPTIONS: Exception[] = [
  {
    id: 'sample-stock-1',
    severity: 'low',
    category: 'samples',
    title: 'Sample stock below 20%',
    detail: 'ARIPIX 5 starter packs. Reorder before the next doctor meet.',
    who: 'Moumita Roy',
    userId: null,
    doctorId: null,
    date: '',
    rule: 'Rep sample balance below 20% of the monthly allocation',
    href: '/',
    sample: true,
  },
];

export function sortExceptions(rows: Exception[]) {
  return [...rows].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || (b.date > a.date ? 1 : -1),
  );
}
