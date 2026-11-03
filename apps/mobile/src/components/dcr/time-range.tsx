import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { durationLabel, spanMinutes } from '@/lib/dcr/model';
import { colors, spacing } from '@/theme';
import { TimeField } from './time-field';

type Range = { startTime: string; endTime: string; durationMin: string };

/** Start + end time; duration is derived and read-only (end must be after start). */
export function TimeRange<T extends Range>({
  value,
  readOnly,
  errors,
  onChange,
}: {
  value: T;
  readOnly: boolean;
  errors: { startTime?: string; endTime?: string };
  onChange: (v: T) => void;
}) {
  const set = (patch: Partial<Range>) => {
    const next = { ...value, ...patch };
    const span = spanMinutes(next.startTime, next.endTime);
    // Keep the saved duration for older records that have no end time yet.
    const durationMin = span !== null ? String(span) : next.endTime ? '' : value.durationMin;
    onChange({ ...next, durationMin });
  };
  const span = spanMinutes(value.startTime, value.endTime);
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.cell}>
          <TimeField
            label="Start time"
            value={value.startTime}
            onChange={(startTime) => set({ startTime })}
            editable={!readOnly}
            error={errors.startTime}
          />
        </View>
        <View style={styles.cell}>
          <TimeField
            label="End time"
            value={value.endTime}
            onChange={(endTime) => set({ endTime })}
            editable={!readOnly}
            error={errors.endTime}
          />
        </View>
      </View>
      <AppText variant="small" style={styles.dur} accessibilityLabel="Duration">
        Duration {durationLabel(span ?? (Number(value.durationMin) || null))}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  cell: { flex: 1 },
  dur: { color: colors.muted },
});
