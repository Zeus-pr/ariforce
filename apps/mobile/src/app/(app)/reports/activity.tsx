import { Redirect, Stack } from 'expo-router';
import { PerfView } from '@/components/perf-view';
import { useAuth } from '@/lib/auth-context';
import { kpiBreakdown, kpiRollup } from '@/lib/perf';
import { isSalesRole } from '@/lib/roles';

const KPIS = [
  'call_average',
  'chemist_call_average',
  'doctor_visits_per_day',
  'dcr_compliance_pct',
  'dcr_on_time_pct',
  'tp_adherence_pct',
] as const;

export default function ActivityReportScreen() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  if (!isSalesRole(roles)) return <Redirect href="/" />;
  return (
    <>
      <Stack.Screen options={{ title: 'Field activity' }} />
      <PerfView
        title="Field activity"
        kpis={KPIS}
        rollup={kpiRollup(roles)}
        breakdown={kpiBreakdown(roles)}
        trendKey="dcr_compliance_pct"
        field
      />
    </>
  );
}
