import { Redirect, Stack, useRouter } from 'expo-router';
import { Card } from '@/components/card';
import { ListRow } from '@/components/list-row';
import { ScrollView } from '@/components/scroll';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { useAuth } from '@/lib/auth-context';
import { isSalesRole } from '@/lib/roles';
import { layout, spacing } from '@/theme';

/** Reports stay as a menu. Each one loads only after it is opened. */
export default function ReportsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const bottom = useBottomSpace();
  if (!isSalesRole(user?.roles ?? [])) return <Redirect href="/" />;
  return (
    <>
      <Stack.Screen options={{ title: 'Reports' }} />
      <ScrollView
        contentContainerStyle={{ padding: layout.gutter, paddingBottom: bottom, gap: spacing.lg }}
      >
        <Card>
          <ListRow
            title="Field activity"
            subtitle="Calls, DCR compliance, tour plan"
            icon="clipboard-check-outline"
            tone="teal"
            divider
            onPress={() => router.push('/reports/activity')}
          />
          <ListRow
            title="Doctor coverage"
            subtitle="Coverage and missed doctors"
            icon="target"
            tone="teal"
            divider
            onPress={() => router.push('/doctor-coverage')}
          />
          <ListRow
            title="Sales and targets"
            subtitle="Primary and secondary sales"
            icon="cash-multiple"
            tone="navy"
            divider
            onPress={() => router.push('/sales')}
          />
          <ListRow
            title="Product detailing"
            subtitle="Calls, samples and orders by product"
            icon="package-variant-closed"
            tone="blue"
            onPress={() => router.push('/reports/products')}
          />
        </Card>
      </ScrollView>
    </>
  );
}
