import { StyleSheet, View } from 'react-native';
import { AppText } from './app-text';
import { radius, spacing, tones, type Tone } from '@/theme';

/** Small status label: text in the tone's foreground on its wash. */
export function Chip({ label, tone }: { label: string; tone: Tone }) {
  const t = tones[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
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
});
