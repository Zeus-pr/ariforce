import { RefreshControl, StyleSheet } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { PULSE } from '@/components/skeleton';
import { colors, radius } from '@/theme';

/**
 * Pull-to-refresh without a spinner. The native control (a circular spinner on both platforms) is
 * kept for the gesture but made invisible; show <RefreshBar active={refreshing} /> at the top of
 * the content instead. The only file allowed to import RefreshControl (eslint override).
 */
export function pullToRefresh(refreshing: boolean, onRefresh: () => void) {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor="transparent"
      colors={['transparent']}
      progressBackgroundColor="transparent"
      style={styles.clear}
    />
  );
}

/** A pulsing skeleton bar while a pull-to-refresh runs (nothing when idle). */
export function RefreshBar({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  if (!active) return null;
  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Refreshing"
      style={[styles.bar, reduced ? null : PULSE]}
    />
  );
}

const styles = StyleSheet.create({
  clear: { backgroundColor: 'transparent' },
  bar: { height: 4, borderRadius: radius.full, backgroundColor: colors.separator },
});
