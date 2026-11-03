import type { DcrDetails } from '@ariforce/contracts';
import { AppText } from '@/components/app-text';
import { durationLabel, plusMinutes } from '@/lib/dcr/model';

/** "10:00 to 11:30 · 1 h 30 min" for meeting / training / admin details (approver view). */
export function DetailsTime({ details }: { details: DcrDetails | null | undefined }) {
  if (!details || !('durationMin' in details)) return null;
  const start = details.startTime ?? '';
  const end = start ? plusMinutes(start, details.durationMin) : '';
  const range = start && end ? `${start} to ${end} · ` : '';
  return <AppText variant="small">{`${range}${durationLabel(details.durationMin)}`}</AppText>;
}
