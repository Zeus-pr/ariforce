import { Redirect, useLocalSearchParams } from 'expo-router';
import { DcrForm } from '@/components/dcr/day-form';
import { useAuth } from '@/lib/auth-context';
import { todayIST } from '@/lib/dcr/dates';
import { isSalesRole } from '@/lib/roles';

/** One DCR report. `tp` = new report prefilled from that approved tour plan, for `date`. */
export default function DcrFormScreen() {
  const {
    id,
    date: dateParam,
    new: isNew,
    tp,
  } = useLocalSearchParams<{
    id?: string;
    date?: string;
    new?: string;
    tp?: string;
  }>();
  const { user } = useAuth();
  const today = todayIST();
  // DCR is for the sales ladder only (web nav.ts SALES).
  if (!isSalesRole(user?.roles ?? [])) return <Redirect href="/" />;
  const initialDate = (typeof dateParam === 'string' && dateParam) || today;
  const reportId = typeof id === 'string' && id ? id : undefined;
  const fromTp = !reportId && typeof tp === 'string' && tp ? tp : undefined;
  const creating = isNew === '1' || !reportId;

  return (
    <DcrForm
      key={`${reportId ?? 'new'}-${initialDate}-${fromTp ?? ''}`}
      today={today}
      initialDate={initialDate}
      reportId={reportId}
      // A TP day is filed for its own date only.
      dateLocked={!creating || !!fromTp}
      fromTp={fromTp}
    />
  );
}
