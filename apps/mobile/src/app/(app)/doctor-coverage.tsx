import { Redirect, Stack } from 'expo-router';
import { PerfView } from '@/components/perf-view';
import { useAuth } from '@/lib/auth-context';
import { kpiBreakdown, kpiRollup } from '@/lib/perf';
import { isSalesRole } from '@/lib/roles';

const KPIS = [
  'coverage_pct',
  'frequency_compliance_pct',
  'missed_doctor_pct',
  'unique_doctors_seen',
  'msl_size',
  'call_average',
] as const;

export default function CoverageScreen() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  if (!isSalesRole(roles)) return <Redirect href="/" />;
  return (
    <>
      <Stack.Screen options={{ title: 'Coverage' }} />
      <PerfView
        title="Coverage"
        kpis={KPIS}
        rollup={kpiRollup(roles)}
        breakdown={kpiBreakdown(roles)}
        trendKey="coverage_pct"
      />
    </>
  );
}
