import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { colors } from '@/theme';

const DOTS = 3;
const STEP_MS = 280;

/** Three-dot loader from the splash mockup: the teal dot walks left to right. */
export function DotLoader() {
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: DOTS,
        duration: STEP_MS * DOTS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, t]);

  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: DOTS }, (_, i) => {
        const active = reduced
          ? i === 0
            ? 1
            : 0
          : t.interpolate({
              inputRange: [i - 0.5, i, i + 0.5, i + 1],
              outputRange: [0, 1, 1, 0],
              extrapolate: 'clamp',
            });
        return (
          <View key={i} style={styles.slot}>
            <View style={[styles.dot, styles.idle]} />
            <Animated.View
              style={[
                styles.dot,
                styles.active,
                {
                  opacity: active,
                  transform: [
                    { scale: reduced ? 1 : Animated.add(0.85, Animated.multiply(active, 0.15)) },
                  ],
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  slot: { width: 8, height: 8 },
  dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
  idle: { backgroundColor: colors.tealSoft },
  active: { backgroundColor: colors.teal },
});
