import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { AppText } from './app-text';
import { Icon } from './icon';
import { colors, radius, spacing } from '@/theme';

const DEPTH = 6; // height of the 3D edge, dp
const FACE_H = 56;

/**
 * Chunky 3D "pushable" button. Emerald = Punch In, red = Punch Out.
 *
 * Loading (GPS wait): face stays pressed; GPS icon breathes; two soft sonar rings expand
 * from the icon; full-width indeterminate track runs under the label. No spinner (app rule).
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
  const wave = useSharedValue(0);
  const faceW = useSharedValue(0);
  const tone = punchedIn
    ? { face: colors.punchOut, edge: colors.punchOutEdge }
    : { face: colors.punchIn, edge: colors.punchInEdge };
  const idleLabel = punchedIn ? 'Punch Out' : 'Punch In';
  const label = loading ? 'Locating…' : idleLabel;
  const inactive = !!(disabled || loading);

  useEffect(() => {
    if (loading) {
      sink.value = withTiming(1, { duration: reduced ? 0 : 100 });
      if (!reduced) {
        wave.value = 0;
        wave.value = withRepeat(
          withTiming(1, { duration: 1600, easing: Easing.out(Easing.cubic) }),
          -1,
          false,
        );
      }
      return;
    }
    cancelAnimation(wave);
    wave.value = 0;
    sink.value = reduced ? 0 : withTiming(0, { duration: 140 });
  }, [loading, reduced, sink, wave]);

  const faceStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sink.value * DEPTH }] }));

  const ringA = useAnimatedStyle(() => {
    const t = wave.value;
    return {
      opacity: interpolate(t, [0, 0.15, 1], [0.55, 0.35, 0]),
      transform: [{ scale: interpolate(t, [0, 1], [0.55, 2.4]) }],
    };
  });
  const ringB = useAnimatedStyle(() => {
    const t = (wave.value + 0.5) % 1;
    return {
      opacity: interpolate(t, [0, 0.15, 1], [0.45, 0.28, 0]),
      transform: [{ scale: interpolate(t, [0, 1], [0.55, 2.4]) }],
    };
  });
  const iconPulse = useAnimatedStyle(() => {
    const s = interpolate(wave.value, [0, 0.5, 1], [1, 1.12, 1]);
    return { transform: [{ scale: reduced || !loading ? 1 : s }] };
  });
  const trackFill = useAnimatedStyle(() => {
    const w = Math.max(faceW.value, 1);
    const thumb = Math.max(56, w * 0.28);
    return {
      width: thumb,
      transform: [{ translateX: interpolate(wave.value, [0, 1], [-thumb, w]) }],
    };
  });

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
        <Animated.View
          style={[styles.face, { backgroundColor: tone.face }, faceStyle]}
          onLayout={(e) => {
            faceW.value = e.nativeEvent.layout.width;
          }}
        >
          <View style={styles.shine} />
          <View style={styles.content}>
            <View style={styles.iconWrap}>
              {loading && !reduced ? (
                <>
                  <Animated.View style={[styles.ring, ringA]} />
                  <Animated.View style={[styles.ring, ringB]} />
                </>
              ) : null}
              <Animated.View style={iconPulse}>
                <Icon
                  name={loading ? 'crosshairs-gps' : punchedIn ? 'logout-variant' : 'login-variant'}
                  size={24}
                  color={colors.onNavy}
                />
              </Animated.View>
            </View>
            <AppText variant="button" style={styles.label}>
              {label}
            </AppText>
          </View>
          {loading ? (
            <View style={styles.track} accessibilityElementsHidden>
              {!reduced ? (
                <Animated.View style={[styles.trackThumb, trackFill]} />
              ) : (
                <View style={[styles.trackThumb, styles.trackThumbStatic]} />
              )}
            </View>
          ) : null}
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
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    zIndex: 1,
  },
  iconWrap: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  shine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: FACE_H / 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  /** Full-bleed indeterminate track under the label — always spans the button. */
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  trackThumb: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 2,
  },
  trackThumbStatic: { left: '30%', width: '40%', opacity: 0.75 },
  label: { color: colors.onNavy, fontSize: 18, letterSpacing: 0.3 },
  dim: { opacity: 0.55 },
});
