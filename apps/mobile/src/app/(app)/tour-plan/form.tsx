import { Redirect, useLocalSearchParams } from 'expo-router';
import { DcrForm } from '@/components/dcr/day-form';
import { useAuth } from '@/lib/auth-context';
import { todayIST } from '@/lib/dcr/dates';
import { isSalesRole } from '@/lib/roles';

/** New or saved tour plan: the DCR day form in TP mode (no calls, from-to, send for approval). */
export default function TourPlanFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const today = todayIST();
  if (!isSalesRole(user?.roles ?? [])) return <Redirect href="/" />;
  const tpId = typeof id === 'string' && id ? id : undefined;
  return (
    <DcrForm
      key={tpId ?? 'new-tp'}
      mode="tp"
      tpId={tpId}
      today={today}
      initialDate={today}
      dateLocked
    />
  );
}
