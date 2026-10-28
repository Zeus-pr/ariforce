import { StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { colors, spacing } from '@/theme';

const DOTS = 3;
const STEP_MS = 280;

/**
 * Three-dot loader from the splash mockup: the teal dot walks left to right. A Reanimated CSS
 * animation (loop, no state change, runs on the UI thread). Reduced motion: one static teal dot.
 */
export function DotLoader() {
  const reduced = useReducedMotion();
  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: DOTS }, (_, i) => (
        <View key={i} style={styles.slot}>
          <View style={[styles.dot, styles.idle]} />
          <Animated.View
            style={[
              styles.dot,
              styles.active,
              reduced
                ? { opacity: i === 0 ? 1 : 0 }
                : {
                    opacity: 0,
                    animationName: {
                      '0%': { opacity: 0, transform: [{ scale: 0.85 }] },
                      '12%': { opacity: 1, transform: [{ scale: 1 }] },
                      '33%': { opacity: 1, transform: [{ scale: 1 }] },
                      '45%': { opacity: 0, transform: [{ scale: 0.85 }] },
                      '100%': { opacity: 0, transform: [{ scale: 0.85 }] },
                    },
                    animationDuration: STEP_MS * DOTS,
                    animationDelay: STEP_MS * i,
                    animationIterationCount: 'infinite',
                    animationTimingFunction: 'linear',
                  },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

const DOT = 8;
const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  slot: { width: DOT, height: DOT },
  dot: { position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2 },
  idle: { backgroundColor: colors.tealSoft },
  active: { backgroundColor: colors.teal },
});
