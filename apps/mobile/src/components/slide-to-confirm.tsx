import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { colors, fonts } from '@/theme';

/**
 * Same gesture as CUTLY’s booking slider. Painted with the AriForce canopy
 * track and a white knob that is pinned inside the track (the in-flow thumb
 * was drawing above the pill).
 */

type Props = {
  label: string;
  doneLabel: string;
  errorLabel: string;
  tone?: 'accept' | 'reject';
  disabled?: boolean;
  onCommit: () => Promise<boolean>;
  onDragChange?: (dragging: boolean) => void;
};

const HEIGHT = 56;
const INSET = 4;
const THUMB_WIDTH = 48;
const COMMIT_THRESHOLD = 0.82;
const COMMIT_VELOCITY = 700;
const RESET_DELAY = 1100;

function travelOf(trackWidth: number) {
  'worklet';
  return Math.max(0, trackWidth - THUMB_WIDTH - INSET * 2);
}

export function SlideToConfirm({
  label,
  doneLabel,
  errorLabel,
  tone = 'accept',
  disabled = false,
  onCommit,
  onDragChange,
}: Props) {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const width = useSharedValue(0);
  const offset = useSharedValue(0);
  const dragStart = useSharedValue(0);
  const rotation = useSharedValue(0);
  const shake = useSharedValue(0);
  const busy = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  useEffect(() => {
    rotation.set(
      phase === 'pending' && !reducedMotion
        ? withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false)
        : 0,
    );
  }, [phase, reducedMotion, rotation]);

  /** Red X, a left-right shake and an error buzz; the knob slides home in the reset above. */
  const failed = useCallback(() => {
    setPhase('error');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (!reducedMotion)
      shake.set(
        withSequence(
          withTiming(-10, { duration: 50 }),
          withRepeat(withTiming(10, { duration: 90 }), 5, true),
          withTiming(0, { duration: 50 }),
        ),
      );
  }, [reducedMotion, shake]);

  const finishCommit = useCallback(async () => {
    if (busy.current || disabled) return;
    busy.current = true;
    setPhase('pending');
    try {
      const succeeded = await onCommit();
      if (!succeeded) {
        failed();
      } else {
        setPhase('done');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      failed();
    } finally {
      busy.current = false;
      resetTimer.current = setTimeout(() => {
        setPhase('idle');
        offset.set(withTiming(0, { duration: 220, reduceMotion: ReduceMotion.System }));
      }, RESET_DELAY);
    }
  }, [disabled, failed, offset, onCommit]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled && phase === 'idle')
        .activeOffsetX(4)
        .failOffsetY([-20, 20])
        .onStart(() => {
          dragStart.set(offset.get());
          if (onDragChange) scheduleOnRN(onDragChange, true);
        })
        .onUpdate((event) => {
          const travel = travelOf(width.get());
          offset.set(Math.min(travel, Math.max(0, dragStart.get() + event.translationX)));
        })
        .onEnd((event) => {
          const travel = travelOf(width.get());
          if (travel === 0) return;
          const progress = offset.get() / travel;
          const commits =
            progress >= COMMIT_THRESHOLD ||
            (progress >= 0.45 && event.velocityX >= COMMIT_VELOCITY);
          if (commits) {
            offset.set(
              reducedMotion
                ? travel
                : withSpring(travel, {
                    duration: 400,
                    dampingRatio: 1,
                    overshootClamping: true,
                    reduceMotion: ReduceMotion.System,
                  }),
            );
            scheduleOnRN(finishCommit);
          } else {
            offset.set(
              reducedMotion
                ? 0
                : withSpring(0, {
                    duration: 400,
                    dampingRatio: 0.8,
                    velocity: event.velocityX,
                    overshootClamping: true,
                    reduceMotion: ReduceMotion.System,
                  }),
            );
          }
        })
        .onFinalize(() => {
          if (onDragChange) scheduleOnRN(onDragChange, false);
        }),
    [disabled, finishCommit, offset, phase, reducedMotion, width, dragStart, onDragChange],
  );

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.get() }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    width: THUMB_WIDTH + offset.get(),
  }));
  const labelStyle = useAnimatedStyle(() => {
    const travel = Math.max(1, travelOf(width.get()));
    return {
      opacity: interpolate(offset.get(), [0, travel * 0.55], [1, 0], 'clamp'),
    };
  });
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }));
  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.get()}deg` }],
  }));

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      width.set(event.nativeEvent.layout.width);
    },
    [width],
  );

  const currentLabel =
    phase === 'pending'
      ? 'Submitting…'
      : phase === 'done'
        ? doneLabel
        : phase === 'error'
          ? errorLabel
          : label;
  const thumbColor =
    phase === 'done'
      ? colors.success
      : phase === 'error' || tone === 'reject'
        ? colors.danger
        : colors.surface;
  const iconColor = thumbColor === colors.surface ? colors.canopyDeep : colors.onNavy;

  return (
    <Animated.View
      onLayout={handleLayout}
      style={[
        styles.track,
        phase === 'error' && styles.trackError,
        disabled && styles.disabled,
        shakeStyle,
      ]}
      accessibilityRole="button"
      accessibilityLabel={currentLabel}
      accessibilityHint="Slide the handle to the right to continue."
      accessibilityState={{ disabled, busy: phase === 'pending' }}
      onAccessibilityTap={() => {
        if (!disabled) void finishCommit();
      }}
    >
      <Animated.View pointerEvents="none" style={[styles.fill, fillStyle]} />
      <Animated.View pointerEvents="none" style={[styles.labelWrap, labelStyle]}>
        <Text numberOfLines={1} style={styles.label}>
          {currentLabel}
        </Text>
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View
          collapsable={false}
          style={[styles.thumb, { backgroundColor: thumbColor }, thumbStyle]}
        >
          {phase === 'pending' ? (
            <Animated.View style={[styles.spinner, spinnerStyle]} />
          ) : (
            <Ionicons
              name={phase === 'done' ? 'checkmark' : phase === 'error' ? 'close' : 'arrow-forward'}
              size={22}
              color={iconColor}
            />
          )}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: HEIGHT,
    width: '100%',
    borderRadius: HEIGHT / 2,
    backgroundColor: colors.canopy,
    overflow: 'hidden',
  },
  trackError: { backgroundColor: colors.danger },
  disabled: { opacity: 0.6 },
  fill: {
    position: 'absolute',
    left: INSET,
    top: INSET,
    height: THUMB_WIDTH,
    borderRadius: THUMB_WIDTH / 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  labelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: THUMB_WIDTH + 16,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'center',
    includeFontPadding: false,
  },
  thumb: {
    position: 'absolute',
    left: INSET,
    top: INSET,
    width: THUMB_WIDTH,
    height: THUMB_WIDTH,
    borderRadius: THUMB_WIDTH / 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  spinner: {
    height: 22,
    width: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.canopyDeep,
    borderTopColor: 'transparent',
  },
});
