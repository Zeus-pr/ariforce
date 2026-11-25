import { Redirect, Stack } from 'expo-router';
import { PerfView } from '@/components/perf-view';
import { useAuth } from '@/lib/auth-context';
import { kpiBreakdown, kpiRollup } from '@/lib/perf';
import { isSalesRole } from '@/lib/roles';

const KPIS = [
  'primary_sales_value',
  'primary_achievement_pct',
  'secondary_sales_value',
  'secondary_achievement_pct',
  'growth_vs_ly_pct',
  'pob_value',
] as const;

export default function SalesScreen() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  if (!isSalesRole(roles)) return <Redirect href="/" />;
  return (
    <>
      <Stack.Screen options={{ title: 'Sales' }} />
      <PerfView
        title="Sales"
        kpis={KPIS}
        rollup={kpiRollup(roles)}
        breakdown={kpiBreakdown(roles)}
        trendKey="secondary_sales_value"
      />
    </>
  );
}
