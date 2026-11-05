import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Icon } from './icon';
import { colors, fonts } from '@/theme';

/**
 * Pixel match of the Motion slide-to-confirm:
 * track h-14 p-1 rounded-full, fill left-1 top-1 bottom-1 rounded-full
 * starting at 48+8, thumb w-11 h-11 rounded-full, chevron ml-3.5.
 * Shared by DCR and tour-plan submit.
 */

export type SlideToConfirmProps = {
  text?: string;
  label?: string;
  confirmedText?: string;
  doneLabel?: string;
  confirmedLabel?: string;
  onConfirm?: () => void | Promise<void>;
  onCommit?: () => Promise<boolean>;
  onReset?: () => void;
  isConfirmed?: boolean;
  disabled?: boolean;
  tone?: 'default' | 'canopy';
  onDragChange?: (dragging: boolean) => void;
  style?: StyleProp<ViewStyle>;
};

const HEIGHT = 56; // h-14
const PAD = 4; // p-1 / left-1
const THUMB = 44; // w-11 h-11
const FILL_REST = 48 + PAD * 2; // source THUMB_SIZE (48) + padding * 2
const COMMIT_AT = 0.85;
const SPRING = { damping: 35, stiffness: 400, mass: 0.8, overshootClamping: true as const };
const SPRING_BACK = { damping: 30, stiffness: 400, mass: 0.8, overshootClamping: true as const };

export function SlideToConfirm({
  text,
  label,
  confirmedText,
  doneLabel,
  confirmedLabel,
  disabled = false,
  tone = 'default',
  isConfirmed: controlledConfirmed,
  onConfirm,
  onCommit,
  onReset,
  onDragChange,
  style,
}: SlideToConfirmProps) {
  const idleLabel = (text ?? label ?? 'Slide to confirm').toUpperCase();
  const successLabel = (confirmedText ?? doneLabel ?? confirmedLabel ?? 'Confirmed').toUpperCase();
  const canopy = tone === 'canopy';

  const [internalConfirmed, setInternalConfirmed] = useState(false);
  const [width, setWidth] = useState(0);
  const isConfirmed = controlledConfirmed ?? internalConfirmed;

  const x = useSharedValue(0);
  const startX = useSharedValue(0);
  const scale = useSharedValue(1);
  const maxX = useSharedValue(0);

  // clientWidth in the web control excludes the border.
  const clientW = Math.max(0, width - 2);
  const travel = Math.max(1, clientW - THUMB - PAD * 2);

  useEffect(() => {
    maxX.value = travel;
    x.value = withSpring(isConfirmed ? travel : 0, SPRING);
  }, [isConfirmed, travel, maxX, x]);

  const setDragging = useCallback((v: boolean) => onDragChange?.(v), [onDragChange]);

  const fail = useCallback(() => {
    setInternalConfirmed(false);
    x.value = withSpring(0, SPRING);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, [x]);

  const commit = useCallback(async () => {
    setInternalConfirmed(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      if (onCommit) {
        const ok = await onCommit();
        if (!ok) throw new Error('failed');
      } else {
        await onConfirm?.();
      }
    } catch {
      fail();
    }
  }, [fail, onCommit, onConfirm]);

  const reset = useCallback(() => {
    setInternalConfirmed(false);
    x.value = withSpring(0, SPRING);
    onReset?.();
  }, [onReset, x]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled && !isConfirmed)
        .activeOffsetX([-2, 2])
        .failOffsetY([-20, 20])
        .onBegin(() => {
          scale.value = withSpring(0.96, SPRING);
          startX.value = x.value;
          runOnJS(setDragging)(true);
        })
        .onUpdate((e) => {
          const max = maxX.value;
          const next = startX.value + e.translationX;
          if (next < 0) x.value = next * 0.05;
          else if (next > max) x.value = max + (next - max) * 0.05;
          else x.value = next;
        })
        .onEnd(() => {
          scale.value = withSpring(1, SPRING);
          const max = maxX.value;
          if (max > 1 && x.value >= max * COMMIT_AT) {
            x.value = withSpring(max, SPRING);
            runOnJS(commit)();
          } else {
            x.value = withSpring(0, SPRING_BACK);
          }
        })
        .onFinalize(() => {
          scale.value = withSpring(1, SPRING);
          runOnJS(setDragging)(false);
        }),
    [commit, disabled, isConfirmed, maxX, scale, setDragging, startX, x],
  );

  const fillStyle = useAnimatedStyle(() => {
    const max = Math.max(1, maxX.value);
    const end = Math.max(FILL_REST, clientW - PAD * 2);
    return {
      width: interpolate(x.value, [0, max], [FILL_REST, end], Extrapolation.CLAMP),
    };
  }, [clientW]);

  const labelStyle = useAnimatedStyle(() => {
    if (isConfirmed) return { opacity: 0 };
    const max = Math.max(1, maxX.value);
    return {
      opacity: interpolate(x.value, [0, max * 0.55], [1, 0], Extrapolation.CLAMP),
    };
  }, [isConfirmed]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { scale: scale.value }],
  }));

  const trackBg = canopy ? colors.canopyTrack : colors.ground;
  const trackBorder = canopy ? 'rgba(255,255,255,0.28)' : colors.separator;
  const knob = canopy ? colors.surface : colors.ink;
  const thumbBg = isConfirmed && canopy ? colors.success : knob;
  const thumbFg = canopy && !isConfirmed ? colors.canopyDeep : colors.onNavy;
  const idleColor = canopy ? 'rgba(255,255,255,0.92)' : colors.muted;
  const doneColor = canopy ? colors.canopyDeep : colors.onNavy;

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[
        styles.track,
        { backgroundColor: trackBg, borderColor: trackBorder },
        disabled && styles.disabled,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={isConfirmed ? successLabel : idleLabel}
      accessibilityState={{ disabled, selected: isConfirmed }}
      onAccessibilityTap={() => {
        if (disabled) return;
        if (isConfirmed) reset();
        else void commit();
      }}
    >
      <Animated.View pointerEvents="none" style={[styles.fill, { backgroundColor: knob }, fillStyle]} />

      <Animated.View pointerEvents="none" style={[styles.labelWrap, labelStyle]}>
        <Text numberOfLines={1} style={[styles.label, { color: idleColor }]}>
          {idleLabel}
        </Text>
      </Animated.View>

      {isConfirmed ? (
        <Pressable style={styles.labelWrap} onPress={disabled ? undefined : reset}>
          <Text numberOfLines={1} style={[styles.label, { color: doneColor }]}>
            {successLabel}
          </Text>
        </Pressable>
      ) : null}

      <GestureDetector gesture={gesture}>
        <Animated.View
          collapsable={false}
          style={[styles.thumb, { backgroundColor: thumbBg }, thumbStyle]}
        >
          <View style={isConfirmed ? undefined : styles.chevron}>
            <Icon
              name={isConfirmed ? 'check' : 'chevron-double-right'}
              size={20}
              color={thumbFg}
            />
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export default SlideToConfirm;

const styles = StyleSheet.create({
  track: {
    height: HEIGHT,
    width: '100%',
    borderRadius: 9999,
    borderWidth: 1,
    overflow: 'hidden',
  },
  disabled: { opacity: 0.5 },
  // left-1 top-1 bottom-1 rounded-full. Height is the track minus border and p-1.
  fill: {
    position: 'absolute',
    left: PAD,
    top: PAD,
    height: HEIGHT - PAD * 2 - 2,
    borderRadius: 9999,
  },
  labelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: FILL_REST + 8,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 14, // text-sm
    lineHeight: 18,
    letterSpacing: 0.7, // tracking-wider
    textAlign: 'center',
    includeFontPadding: false,
  },
  // w-11 h-11 rounded-full, sitting in the p-1 inset (flex start, vertically centered).
  thumb: {
    position: 'absolute',
    left: PAD,
    top: (HEIGHT - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  // ChevronsRight ml-3.5 — icon sits on the right of the knob.
  chevron: { marginLeft: 14 },
});
