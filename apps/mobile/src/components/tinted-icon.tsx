import { StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './icon';
import { iconSize, radius, sizes, tones, type Tone } from '@/theme';

/** Icon on a soft square of its own tint (cards, rows, quick actions). */
export function TintedIcon({ name, tone, large }: { name: IconName; tone: Tone; large?: boolean }) {
  const t = tones[tone];
  return (
    <View
      style={[styles.box, large ? styles.large : styles.regular, { backgroundColor: t.bg }]}
      importantForAccessibility="no-hide-descendants"
    >
      <Icon name={name} color={t.fg} size={large ? iconSize.lg : iconSize.md} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' },
  regular: { width: sizes.iconTile, height: sizes.iconTile, borderRadius: radius.md },
  large: { width: sizes.iconTileLg, height: sizes.iconTileLg, borderRadius: radius.lg },
});
