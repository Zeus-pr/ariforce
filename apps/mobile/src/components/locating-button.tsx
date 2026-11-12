import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
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
import { colors, radius, spacing, touch } from '@/theme';

/**
 * Primary action with the same GPS locating motion as Home Punch:
 * sonar rings on the GPS icon + full-width indeterminate track.
 */
export function LocatingButton({
  label,
  locatingLabel = 'Locating…',
  onPress,
  loading,
  disabled,
  done,
  style,
}: {
  label: string;
  locatingLabel?: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Soft success look when already completed. */
  done?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const wave = useSharedValue(0);
  const faceW = useSharedValue(0);
  const inactive = !!(disabled || loading || done);
  const showLocating = !!loading && !done;

  useEffect(() => {
    if (showLocating && !reduced) {
      wave.value = 0;
      wave.value = withRepeat(
        withTiming(1, { duration: 1600, easing: Easing.out(Easing.cubic) }),
        -1,
        false,
      );
      return;
    }
    cancelAnimation(wave);
    wave.value = 0;
  }, [showLocating, reduced, wave]);

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
    return { transform: [{ scale: reduced || !showLocating ? 1 : s }] };
  });
  const trackFill = useAnimatedStyle(() => {
    const w = Math.max(faceW.value, 1);
    const thumb = Math.max(56, w * 0.28);
    return {
      width: thumb,
      transform: [{ translateX: interpolate(wave.value, [0, 1], [-thumb, w]) }],
    };
  });

  const bg = done ? colors.successWash : showLocating ? colors.navyPressed : colors.navy;
  const fg = done ? colors.success : colors.onNavy;

  return (
    <Pressable
      disabled={inactive}
      onPress={() => {
        if (inactive) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: showLocating }}
      accessibilityHint={showLocating ? 'Getting your location' : undefined}
      style={[style, disabled && !loading ? styles.dim : null]}
    >
      <View
        style={[styles.face, { backgroundColor: bg }]}
        onLayout={(e) => {
          faceW.value = e.nativeEvent.layout.width;
        }}
      >
        <View style={styles.content}>
          <View style={styles.iconWrap}>
            {showLocating && !reduced ? (
              <>
                <Animated.View style={[styles.ring, ringA]} />
                <Animated.View style={[styles.ring, ringB]} />
              </>
            ) : null}
            <Animated.View style={iconPulse}>
              <Icon
                name={done ? 'check' : showLocating ? 'crosshairs-gps' : 'map-marker-radius'}
                size={22}
                color={fg}
              />
            </Animated.View>
          </View>
          <AppText variant="button" style={{ color: fg }}>
            {showLocating ? locatingLabel : label}
          </AppText>
        </View>
        {showLocating ? (
          <View style={styles.track} accessibilityElementsHidden>
            {!reduced ? (
              <Animated.View style={[styles.trackThumb, trackFill]} />
            ) : (
              <View style={[styles.trackThumb, styles.trackThumbStatic]} />
            )}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  face: {
    minHeight: touch.control,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
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
  dim: { opacity: 0.55 },
});
