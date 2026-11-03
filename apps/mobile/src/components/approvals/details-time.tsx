import type { DcrDetails } from '@ariforce/contracts';
import { AppText } from '@/components/app-text';
import { durationLabel, plusMinutes } from '@/lib/dcr/model';
import { readPlaces } from '@/lib/dcr/v2-adapter';

/** Places + "10:00 to 11:30 · 1 h 30 min" for meeting / training / admin details (approver view). */
export function DetailsTime({ details }: { details: DcrDetails | null | undefined }) {
  if (!details || !('durationMin' in details)) return null;
  const start = details.startTime ?? '';
  const end = start ? plusMinutes(start, details.durationMin) : '';
  const range = start && end ? `${start} to ${end} · ` : '';
  const p = readPlaces(details);
  return (
    <>
      <AppText variant="small">{`${range}${durationLabel(details.durationMin)}`}</AppText>
      {p.fromPlace || p.toPlace ? (
        <AppText variant="small">{`From ${p.fromPlace || '—'} to ${p.toPlace || '—'}`}</AppText>
      ) : null}
    </>
  );
}
