import { StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { Icon, type IconName } from '../icon';
import { PressableScale } from '../pressable-scale';
import { FEATURES, canOpenFeature, type FeatureKey } from '@/lib/features';
import { colors, fonts, radius, spacing } from '@/theme';

const TILES: { key: FeatureKey; label: string; icon: IconName }[] = [
  { key: 'doctors', label: 'Doctors', icon: 'stethoscope' },
  { key: 'chemists', label: 'Chemist', icon: 'pill' },
  { key: 'stockists', label: 'Stockist', icon: 'truck-delivery-outline' },
];

const GAP = spacing.sm;

/** Business masters — three canopy tiles in one row (below Quick Actions). */
export function BusinessTiles({
  onOpen,
  roles,
}: {
  onOpen: (feature: FeatureKey) => void;
  roles: readonly string[];
}) {
  const items = TILES.filter((t) => canOpenFeature(t.key, roles));

  return (
    <View style={styles.wrap}>
      <AppText variant="chip" style={styles.section}>
        BUSINESS
      </AppText>
      <View style={styles.grid}>
        {items.map((t) => (
          <PressableScale
            key={t.key}
            onPress={() => onOpen(t.key)}
            accessibilityLabel={`${t.label}. ${FEATURES[t.key].short}`}
            containerStyle={styles.cell}
            style={styles.tile}
            pressedStyle={styles.pressed}
          >
            <Icon name={t.icon} size={26} color={colors.onNavy} />
            <AppText variant="action" style={styles.title} numberOfLines={1}>
              {t.label}
            </AppText>
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  section: {
    color: colors.subtle,
    fontFamily: fonts.bold,
    letterSpacing: 0.6,
  },
  grid: {
    flexDirection: 'row',
    gap: GAP,
  },
  tile: {
    height: 96,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.canopy,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  cell: { flex: 1 },
  pressed: { backgroundColor: colors.canopyDeep },
  title: { color: colors.onNavy, fontFamily: fonts.bold, fontSize: 13 },
});
