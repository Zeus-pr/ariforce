import { StyleSheet, View } from 'react-native';
import { AppText } from './app-text';
import { radius, spacing, tones, type Tone } from '@/theme';

/** Small status label: text in the tone's foreground on its wash. */
export function Chip({
  label,
  tone,
  center = false,
}: {
  label: string;
  tone: Tone;
  /** Centre in a column (default: hugs the start edge). */
  center?: boolean;
}) {
  const t = tones[tone];
  return (
    <View style={[styles.chip, center && styles.center, { backgroundColor: t.bg }]}>
      <AppText variant="chip" style={{ color: t.fg }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  center: { alignSelf: 'center' },
});
