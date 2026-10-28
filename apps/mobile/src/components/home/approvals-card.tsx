import { StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { cardStyles } from '../card';
import { PressableScale } from '../pressable-scale';
import { SectionHeader } from '../section-header';
import type { HomeData } from '@/mocks/home';
import { colors, spacing } from '@/theme';

/** Manager roles only (ABM and above): what the team is waiting on. */
export function ApprovalsCard({
  counts,
  onOpen,
}: {
  counts: HomeData['approvals'];
  onOpen: () => void;
}) {
  const cells = [
    { label: 'DCR', n: counts.dcr },
    { label: 'Tour plans', n: counts.tourPlans },
    { label: 'Leave', n: counts.leave },
    { label: 'Expenses', n: counts.expenses },
  ];
  const total = cells.reduce((s, c) => s + c.n, 0);
  if (total === 0) return null;

  return (
    <>
      <SectionHeader title="Waiting for you" meta={`${total} to approve`} />
      <PressableScale
        onPress={onOpen}
        accessibilityLabel={`Approvals: ${cells.map((c) => `${c.n} ${c.label}`).join(', ')}`}
        style={[cardStyles.card, styles.card]}
        pressedStyle={styles.pressed}
        scaleTo={0.98}
      >
        {cells.map((c, i) => (
          <View key={c.label} style={[styles.cell, i > 0 && styles.cellRule]}>
            <AppText variant="count" style={c.n === 0 && styles.zero}>
              {c.n}
            </AppText>
            <AppText variant="small" numberOfLines={1}>
              {c.label}
            </AppText>
          </View>
        ))}
      </PressableScale>
    </>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'stretch', paddingVertical: spacing.lg },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs },
  cellRule: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.separator },
  zero: { color: colors.subtle },
  pressed: { backgroundColor: colors.ground },
});
