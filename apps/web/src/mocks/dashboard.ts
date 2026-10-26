/**
 * SAMPLE DATA for the dashboard's "Needs attention" list, the only part no contract covers yet
 * (see docs/CONTRACT-GAPS.md: exceptions feed). KPIs, team rows, products and approvals come from
 * the typed client. Shown with a "Sample data" badge.
 */

export type Severity = 'high' | 'medium' | 'low';
export type Attention = { id: string; severity: Severity; title: string; detail: string; who: string; area: string; age: string; action: string };

export const MOCK_ATTENTION: Attention[] = [
  { id: 'a1', severity: 'high', title: '14 A-class doctors not visited', detail: 'Day 19 of 26. Required 2 visits each this cycle.', who: 'Sayan Mukherjee', area: 'Salt Lake', age: 'Today', action: 'Review list' },
  { id: 'a2', severity: 'high', title: 'DCR missing for 2 days', detail: 'No call report for 24 and 25 Oct. Punch-in recorded both days.', who: 'Ritika Ghosh', area: 'Howrah', age: '2 days', action: 'Remind' },
  { id: 'a3', severity: 'medium', title: '3 calls outside geofence', detail: 'Check-ins 1.2 to 3.4 km from the doctor’s listed clinic.', who: 'Arjun Das', area: 'Behala', age: 'Yesterday', action: 'Inspect' },
  { id: 'a4', severity: 'medium', title: 'November tour plans waiting', detail: '3 reps submitted. Plans lock on 28 Oct.', who: '3 reps', area: 'Kolkata region', age: '1 day', action: 'Open plans' },
  { id: 'a5', severity: 'low', title: 'Sample stock below 20%', detail: 'Arifer-XT 10s. Reorder before the next doctor meet.', who: 'Moumita Roy', area: 'Dum Dum', age: '3 days', action: 'View stock' },
];
