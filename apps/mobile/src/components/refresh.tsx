import { Children, cloneElement, useCallback, useRef, useState, type ReactElement } from 'react';
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { PULSE } from '@/components/skeleton';
import { colors, radius, spacing } from '@/theme';

const TRIGGER = 80; // dp of pull that refreshes
const MIN_MS = 600; // keep the bar long enough to be seen

/**
 * Pull-to-refresh with no spinner at all. Android's SwipeRefreshLayout always draws its disc and
 * arc (transparent colours still leave the shadowed disc), so the app does not use RefreshControl.
 * Instead a gesture-handler Pan over the scroll view, active only while the list is at the top,
 * grows a skeleton bar while pulling and pulses it while the refresh runs. Only a user pull shows
 * it: background fetches never do.
 *
 *   <PullToRefresh onRefresh={() => q.refetch()}>
 *     <ScrollView …/>
 *   </PullToRefresh>
 */
export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => unknown;
  children: ReactElement<{
    onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
    scrollEventThrottle?: number;
  }>;
}) {
  const reduced = useReducedMotion();
  const atTop = useSharedValue(true);
  const pull = useSharedValue(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const t0 = Date.now();
    try {
      await onRefresh();
    } catch {
      // the screen shows its own error state
    }
    setTimeout(
      () => {
        busyRef.current = false;
        setBusy(false);
      },
      Math.max(0, MIN_MS - (Date.now() - t0)),
    );
  }, [onRefresh]);

  const pan = Gesture.Pan()
    .activeOffsetY(12)
    .failOffsetX([-24, 24])
    .onUpdate((e) => {
      pull.value = atTop.value ? Math.max(0, Math.min(e.translationY, TRIGGER * 1.5)) : 0;
    })
    .onEnd(() => {
      if (pull.value >= TRIGGER) runOnJS(run)();
      pull.value = withTiming(0, { duration: 180 });
    })
    .onFinalize(() => {
      if (pull.value > 0) pull.value = withTiming(0, { duration: 180 });
    });
  // Let the scroll view keep scrolling while the pan watches.
  const scroll = Gesture.Native();
  const both = Gesture.Simultaneous(pan, scroll);

  const pullBar = useAnimatedStyle(() => ({
    width: `${Math.min(100, (pull.value / TRIGGER) * 100)}%`,
    opacity: pull.value > 0 ? 1 : 0,
  }));

  const child = Children.only(children);
  const userOnScroll = child.props.onScroll;
  const scrolled = cloneElement(child, {
    scrollEventThrottle: child.props.scrollEventThrottle ?? 16,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      atTop.value = e.nativeEvent.contentOffset.y <= 1;
      userOnScroll?.(e);
    },
  });

  return (
    <View style={styles.flex}>
      <GestureDetector gesture={both}>{scrolled}</GestureDetector>
      <View pointerEvents="none" style={styles.track}>
        {busy ? (
          <Animated.View
            accessibilityRole="progressbar"
            accessibilityLabel="Refreshing"
            style={[styles.bar, styles.full, reduced ? null : PULSE]}
          />
        ) : (
          <Animated.View style={[styles.bar, pullBar]} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  track: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
  },
  bar: { height: 4, borderRadius: radius.full, backgroundColor: colors.separator },
  full: { width: '100%' },
});
