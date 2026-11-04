import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { AppText } from './app-text';
import { Icon } from './icon';
import { PULSE } from './skeleton';
import { colors, radius, spacing } from '@/theme';

const DEPTH = 6; // height of the 3D edge, dp
const FACE_H = 56;
const SHIMMER_W = 72;

/**
 * Chunky 3D "pushable" button: a darker edge sits under the face; pressing sinks the face onto
 * the edge. Emerald = Punch In, vibrant red = Punch Out.
 *
 * While GPS/API is in flight (`loading`): keep the face pressed, swap copy to “Getting location…”,
 * and run a soft indeterminate shimmer (no spinner — app convention). Reduced motion: static label only.
 */
export function PunchButton({
  punchedIn,
  onPress,
  disabled,
  loading,
}: {
  punchedIn: boolean;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const reduced = useReducedMotion();
  const sink = useSharedValue(0);
  const shimmer = useSharedValue(0);
  const tone = punchedIn
    ? { face: colors.punchOut, edge: colors.punchOutEdge }
    : { face: colors.punchIn, edge: colors.punchInEdge };
  const idleLabel = punchedIn ? 'Punch Out' : 'Punch In';
  const label = loading ? 'Getting location…' : idleLabel;
  const inactive = !!(disabled || loading);

  useEffect(() => {
    if (loading) {
      sink.value = withTiming(1, { duration: reduced ? 0 : 120 });
      if (!reduced) {
        shimmer.value = 0;
        shimmer.value = withRepeat(
          withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
          -1,
          false,
        );
      }
      return;
    }
    cancelAnimation(shimmer);
    shimmer.value = 0;
    if (!reduced) sink.value = withTiming(0, { duration: 140 });
    else sink.value = 0;
  }, [loading, reduced, sink, shimmer]);

  const faceStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sink.value * DEPTH }] }));
  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -SHIMMER_W + shimmer.value * (320 + SHIMMER_W) }],
  }));

  const press = (down: boolean) => {
    if (inactive) return;
    sink.value = reduced ? (down ? 1 : 0) : withTiming(down ? 1 : 0, { duration: down ? 60 : 140 });
  };

  return (
    <Pressable
      disabled={inactive}
      onPressIn={() => {
        press(true);
        if (!inactive) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }}
      onPressOut={() => press(false)}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={idleLabel}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      accessibilityHint={
        loading ? 'Getting your location' : punchedIn ? 'Ends your shift' : 'Starts your shift'
      }
      style={disabled && !loading ? styles.dim : undefined}
    >
      <View style={styles.wrap}>
        <View style={[styles.edge, { backgroundColor: tone.edge }]} />
        <Animated.View style={[styles.face, { backgroundColor: tone.face }, faceStyle]}>
          <View style={styles.shine} />
          {loading && !reduced ? (
            <Animated.View
              pointerEvents="none"
              style={[styles.shimmer, shimmerStyle]}
              accessibilityElementsHidden
            />
          ) : null}
          <Animated.View style={[styles.content, loading && !reduced ? PULSE : null]}>
            <Icon
              name={loading ? 'crosshairs-gps' : punchedIn ? 'logout-variant' : 'login-variant'}
              size={24}
              color={colors.onNavy}
            />
            <AppText variant="button" style={styles.label}>
              {label}
            </AppText>
          </Animated.View>
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { height: FACE_H + DEPTH },
  edge: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: DEPTH,
    height: FACE_H,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
  },
  face: {
    height: FACE_H,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  // Soft top highlight gives the face its raised, glossy look.
  shine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: FACE_H / 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  // Indeterminate “work is happening” sweep while GPS resolves (unknown duration).
  shimmer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: SHIMMER_W,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  label: { color: colors.onNavy, fontSize: 18, letterSpacing: 0.3 },
  dim: { opacity: 0.55 },
});
