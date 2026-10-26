/**
 * MOCK DATA for the placeholder manager dashboard.
 * No API exists yet: this is not an endpoint contract. Replace with the Architect's typed client
 * (packages/contracts) once the dashboard endpoints are defined. KPI definitions follow
 * docs/research/ux-patterns.md (PR #16) and still need confirming with Arighna.
 */

export const MOCK_SCOPE = {
  breadcrumb: ['East zone', 'Kolkata region', 'All areas'],
  cycle: 'October 2026 cycle',
  cycleDay: 19,
  cycleDays: 26,
};

export type Kpi = { key: string; label: string; value: number; suffix?: string; decimals?: number; target: string; delta: string; trend: 'up' | 'down' | 'flat' };

export const MOCK_KPIS: Kpi[] = [
  { key: 'call-average', label: 'Call average', value: 9.4, decimals: 1, target: 'Target 10', delta: '+0.3 vs last cycle', trend: 'up' },
  { key: 'coverage', label: 'Coverage', value: 71, suffix: '%', target: 'Target 90%', delta: '-4 pts vs last cycle', trend: 'down' },
  { key: 'frequency', label: 'Frequency compliance', value: 58, suffix: '%', target: 'Target 80%', delta: '+2 pts vs last cycle', trend: 'up' },
  { key: 'dcr', label: 'DCR compliance', value: 86, suffix: '%', target: 'Target 95%', delta: 'Flat vs last cycle', trend: 'flat' },
];

export type Severity = 'high' | 'medium' | 'low';
export type Attention = { id: string; severity: Severity; title: string; detail: string; who: string; area: string; age: string; action: string };

export const MOCK_ATTENTION: Attention[] = [
  { id: 'a1', severity: 'high', title: '14 A-class doctors not visited', detail: 'Day 19 of 26. Required 2 visits each this cycle.', who: 'Sayan Mukherjee', area: 'Salt Lake', age: 'Today', action: 'Review list' },
  { id: 'a2', severity: 'high', title: 'DCR missing for 2 days', detail: 'No call report for 24 and 25 Oct. Punch-in recorded both days.', who: 'Ritika Ghosh', area: 'Howrah', age: '2 days', action: 'Remind' },
  { id: 'a3', severity: 'medium', title: '3 calls outside geofence', detail: 'Check-ins 1.2 to 3.4 km from the doctor’s listed clinic.', who: 'Arjun Das', area: 'Behala', age: 'Yesterday', action: 'Inspect' },
  { id: 'a4', severity: 'medium', title: 'November tour plans waiting', detail: '3 reps submitted. Plans lock on 28 Oct.', who: '3 reps', area: 'Kolkata region', age: '1 day', action: 'Open plans' },
  { id: 'a5', severity: 'low', title: 'Sample stock below 20%', detail: 'Arifer-XT 10s. Reorder before the next doctor meet.', who: 'Moumita Roy', area: 'Dum Dum', age: '3 days', action: 'View stock' },
];

export type Approval = { id: string; type: 'Tour plan' | 'DCR' | 'Leave'; rep: string; area: string; submitted: string; summary: string };

export const MOCK_APPROVALS: Approval[] = [
  { id: 'p1', type: 'Tour plan', rep: 'Sayan Mukherjee', area: 'Salt Lake', submitted: '25 Oct, 18:40', summary: 'Nov · 22 field days · 186 planned calls' },
  { id: 'p2', type: 'Tour plan', rep: 'Arjun Das', area: 'Behala', submitted: '25 Oct, 21:05', summary: 'Nov · 21 field days · 171 planned calls' },
  { id: 'p3', type: 'Tour plan', rep: 'Moumita Roy', area: 'Dum Dum', submitted: '26 Oct, 09:12', summary: 'Nov · 23 field days · 190 planned calls' },
  { id: 'p4', type: 'DCR', rep: 'Ritika Ghosh', area: 'Howrah', submitted: '26 Oct, 20:31', summary: 'Late DCR for 23 Oct · 8 doctor calls' },
  { id: 'p5', type: 'Leave', rep: 'Arjun Das', area: 'Behala', submitted: '26 Oct, 11:02', summary: '3 Nov · Casual leave' },
];

export type RepRow = { rep: string; area: string; calls: number; callAvg: number; coverage: number; missedA: number; dcrOnTime: number };

export const MOCK_TEAM: RepRow[] = [
  { rep: 'Sayan Mukherjee', area: 'Salt Lake', calls: 168, callAvg: 9.9, coverage: 64, missedA: 14, dcrOnTime: 94 },
  { rep: 'Ritika Ghosh', area: 'Howrah', calls: 142, callAvg: 8.4, coverage: 69, missedA: 6, dcrOnTime: 76 },
  { rep: 'Arjun Das', area: 'Behala', calls: 171, callAvg: 10.1, coverage: 78, missedA: 3, dcrOnTime: 100 },
  { rep: 'Moumita Roy', area: 'Dum Dum', calls: 159, callAvg: 9.4, coverage: 74, missedA: 5, dcrOnTime: 88 },
];
