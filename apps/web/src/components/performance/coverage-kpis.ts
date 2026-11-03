import { num, pct, type PerfCol } from './perf-ui';
import { val, type Row } from './use-perf';

export const COVERAGE_KPIS = [
  'coverage_pct',
  'frequency_compliance_pct',
  'missed_doctor_pct',
  'unique_doctors_seen',
  'msl_size',
  'call_average',
] as const;

export const coverageCols = (first: string): PerfCol<Row>[] => [
  { header: first, get: (r) => r.label },
  { header: 'MSL size', get: (r) => val(r, 'msl_size') },
  { header: 'Doctors seen', get: (r) => val(r, 'unique_doctors_seen') },
  { header: 'Coverage', get: (r) => val(r, 'coverage_pct'), format: pct },
  { header: 'Frequency compliance', get: (r) => val(r, 'frequency_compliance_pct'), format: pct },
  { header: 'Missed doctors', get: (r) => val(r, 'missed_doctor_pct'), format: pct },
  { header: 'Call average', get: (r) => val(r, 'call_average'), format: num },
];
