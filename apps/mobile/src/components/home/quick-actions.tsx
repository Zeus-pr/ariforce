import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { Icon, type IconName } from '../icon';
import { PressableScale } from '../pressable-scale';
import { canOpenFeature, type FeatureKey } from '@/lib/features';
import { colors, fonts, radius, spacing } from '@/theme';

const ACTIONS: {
  key: FeatureKey;
  label: string;
  icon: IconName;
}[] = [
  { key: 'dcr', label: 'DCR Entry', icon: 'file-document-outline' },
  { key: 'tour-plan', label: 'Tour Plan', icon: 'map-outline' },
  { key: 'pob', label: 'POB', icon: 'cart-outline' },
  { key: 'expenses', label: 'Expense', icon: 'receipt-text-outline' },
];

const GAP = spacing.sm;

/** Stitch navy 2×2 quick-action cards — full content width, tight gap. */
export function QuickActions({
  onOpen,
  roles,
}: {
  onOpen: (feature: FeatureKey) => void;
  roles: readonly string[];
}) {
  // Measure the container (not the window) so tiles fill the column; 4 across on wide screens.
  const [w, setW] = useState(0);
  const cols = w >= 560 ? 4 : 2;
  const tileW = w > 0 ? Math.floor((w - GAP * (cols - 1)) / cols) : undefined;
  const items = ACTIONS.filter((a) => canOpenFeature(a.key, roles));

  return (
    <View style={styles.wrap}>
      <AppText variant="chip" style={styles.section}>
        QUICK ACTIONS
      </AppText>
      <View style={styles.grid} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {items.map((a) => (
          <PressableScale
            key={a.key}
            onPress={() => onOpen(a.key)}
            accessibilityLabel={a.label}
            containerStyle={tileW ? { width: tileW } : styles.pending}
            style={styles.tile}
            pressedStyle={styles.pressed}
          >
            <Icon name={a.icon} size={28} color={colors.onNavy} />
            <View style={styles.copy}>
              <AppText variant="action" style={styles.title} numberOfLines={1}>
                {a.label}
              </AppText>
            </View>
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
    flexWrap: 'wrap',
    gap: GAP,
  },
  tile: {
    height: 88,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.navy,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  pending: { opacity: 0 },
  pressed: { backgroundColor: colors.navyPressed },
  copy: { alignItems: 'center', gap: 2 },
  title: { color: colors.onNavy, fontFamily: fonts.bold, fontSize: 14 },
});
