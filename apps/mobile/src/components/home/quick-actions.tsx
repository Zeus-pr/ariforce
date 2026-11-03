import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { Icon, type IconName } from '../icon';
import { PressableScale } from '../pressable-scale';
import { canOpenFeature, type FeatureKey } from '@/lib/features';
import type { HomeData } from '@/mocks/home';
import { colors, fonts, radius, spacing } from '@/theme';

const ACTIONS: {
  key: FeatureKey;
  label: string;
  icon: IconName;
  hintKey: keyof HomeData['quickHints'];
}[] = [
  { key: 'dcr', label: 'DCR Entry', icon: 'file-document-outline', hintKey: 'dcr' },
  { key: 'tour-plan', label: 'Tour Plan', icon: 'map-outline', hintKey: 'tourPlan' },
  { key: 'pob', label: 'POB', icon: 'cart-outline', hintKey: 'pob' },
  { key: 'expenses', label: 'Expense', icon: 'receipt-text-outline', hintKey: 'expenses' },
];

const GAP = spacing.sm;

/** Stitch navy 2×2 quick-action cards — full content width, tight gap. */
export function QuickActions({
  onOpen,
  roles,
  hints,
}: {
  onOpen: (feature: FeatureKey) => void;
  roles: readonly string[];
  hints?: HomeData['quickHints'] | null;
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
            accessibilityLabel={`${a.label}. ${hints?.[a.hintKey] ?? ''}`}
            containerStyle={tileW ? { width: tileW } : styles.pending}
            style={styles.tile}
            pressedStyle={styles.pressed}
          >
            <Icon name={a.icon} size={28} color={colors.onNavy} />
            <View style={styles.copy}>
              <AppText variant="action" style={styles.title} numberOfLines={1}>
                {a.label}
              </AppText>
              <AppText variant="small" style={styles.hint} numberOfLines={1}>
                {hints?.[a.hintKey] ?? ''}
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
    height: 102,
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
  hint: { color: 'rgba(203, 213, 225, 1)', fontSize: 11, lineHeight: 14 },
});
