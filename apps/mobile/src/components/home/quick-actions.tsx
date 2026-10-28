import { StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { cardStyles } from '../card';
import { PressableScale } from '../pressable-scale';
import { SectionHeader } from '../section-header';
import { TintedIcon } from '../tinted-icon';
import { FEATURES, type FeatureKey } from '@/lib/features';
import { colors, layout, sizes, spacing } from '@/theme';

const ACTIONS = ['dcr', 'tour-plan', 'leave', 'expenses'] as const satisfies readonly FeatureKey[];

/** One row of four: the forms a rep opens every day or week. */
export function QuickActions({ onOpen }: { onOpen: (feature: FeatureKey) => void }) {
  return (
    <>
      <SectionHeader title="Quick actions" />
      <View style={styles.row}>
        {ACTIONS.map((key) => {
          const f = FEATURES[key];
          return (
            <PressableScale
              key={key}
              onPress={() => onOpen(key)}
              accessibilityLabel={f.title}
              containerStyle={styles.cell}
              style={[cardStyles.card, styles.tile]}
              pressedStyle={styles.pressed}
            >
              <TintedIcon name={f.icon} tone={f.tone} large />
              <AppText variant="action" numberOfLines={1}>
                {f.title}
              </AppText>
            </PressableScale>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: layout.inner },
  cell: { flex: 1 },
  // Fixed tile height: four equal boxes whatever the label.
  tile: {
    height: sizes.tile,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  pressed: { backgroundColor: colors.ground },
});
