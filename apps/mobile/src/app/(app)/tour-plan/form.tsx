import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { DcrForm } from '@/components/dcr/day-form';
import { useAuth } from '@/lib/auth-context';
import { todayIST } from '@/lib/dcr/dates';
import { isSalesRole } from '@/lib/roles';
import { tpDefaultFromDate, tpFutureMonthCutoffError } from '@/lib/tp/adapter';
import { layout, spacing } from '@/theme';

/** New or saved tour plan: the DCR day form in TP mode (no calls, from-to, send for approval). */
export default function TourPlanFormScreen() {
  const { id, date } = useLocalSearchParams<{ id?: string; date?: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const today = todayIST();
  if (!isSalesRole(user?.roles ?? [])) return <Redirect href="/" />;
  const tpId = typeof id === 'string' && id ? id : undefined;
  const openFrom = tpDefaultFromDate();
  const requested = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const start = tpId
    ? requested && !tpFutureMonthCutoffError(requested)
      ? requested
      : openFrom
    : requested && !tpFutureMonthCutoffError(requested)
      ? requested
      : openFrom;

  if (!tpId && !start) {
    return (
      <View style={{ flex: 1, padding: layout.gutter, gap: spacing.lg, justifyContent: 'center' }}>
        <Stack.Screen options={{ title: 'Tour plan' }} />
        <AppText variant="body">
          Tour plans are only for the next month, and that window closed after the 22nd at 12:10 AM
          IST.
        </AppText>
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <DcrForm
      key={tpId ?? `new-tp-${start}`}
      mode="tp"
      tpId={tpId}
      today={today}
      initialDate={start ?? openFrom ?? today}
      dateLocked
    />
  );
}
