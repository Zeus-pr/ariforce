import { Card } from '../card';
import { Chip } from '../chip';
import { ListRow } from '../list-row';
import { SectionHeader } from '../section-header';
import { formatTime } from '@/lib/format';
import type { PlannedDoctor } from '@/mocks/home';

/** Doctors on today's plan, met ones marked with the call time. */
export function DoctorsToday({
  doctors,
  onOpenDoctors,
}: {
  doctors: PlannedDoctor[];
  onOpenDoctors: () => void;
}) {
  if (doctors.length === 0) return null;
  const met = doctors.filter((d) => d.metAt).length;
  return (
    <>
      <SectionHeader
        title="Doctors today"
        meta={`${met} of ${doctors.length} met`}
        action={{ label: 'All doctors', onPress: onOpenDoctors }}
      />
      <Card>
        {doctors.map((d, i) => {
          const status = d.metAt ? `Met ${formatTime(d.metAt)}` : 'Planned';
          return (
            <ListRow
              key={d.id}
              icon="stethoscope"
              tone={d.metAt ? 'green' : 'teal'}
              title={d.name}
              subtitle={`${d.speciality} · ${d.area}`}
              trailing={<Chip label={status} tone={d.metAt ? 'green' : 'neutral'} />}
              onPress={onOpenDoctors}
              accessibilityLabel={`${d.name}, ${d.speciality}, ${d.area}, ${status}`}
              divider={i < doctors.length - 1}
            />
          );
        })}
      </Card>
    </>
  );
}
