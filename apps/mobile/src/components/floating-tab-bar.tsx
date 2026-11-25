import * as Haptics from 'expo-haptics';
import { Watermark } from './watermark';
import { useFocusEffect, type Tabs as TabsType } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  Easing,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from './icon';
import { canBlur, getBlurKit } from '@/lib/blur';
import {
  colors,
  glass,
  iconSize,
  layout,
  radius,
  shadows,
  sizes,
  spacing,
  tabLabel,
  touch,
} from '@/theme';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof TabsType>['tabBar']>>[0];
type TargetRef = RefObject<ComponentRef<typeof View> | null>;

export type TabMeta = {
  /** Short word shown in the bar ("Plans"). */
  label: string;
  /** Full name for screen readers ("Tour Plan"); the screen title stays the full name too. */
  a11yLabel: string;
  icon: IconName;
  iconActive: IconName;
};

type TabBarState = {
  /** Android: the focused scene's BlurTargetView (what the blur samples), with a change counter. */
  target: { ref: TargetRef; id: number } | null;
  setTarget: (ref: TargetRef) => void;
};

/** Non-null inside the tab navigator: screens there pad for the floating bar. */
const TabBarContext = createContext<TabBarState | null>(null);

export function TabBarProvider({ children }: { children: ReactNode }) {
  const [target, setTargetState] = useState<TabBarState['target']>(null);
  const setTarget = useCallback(
    (ref: TargetRef) => setTargetState((t) => (t?.ref === ref ? t : { ref, id: (t?.id ?? 0) + 1 })),
    [],
  );
  const value = useMemo(() => ({ target, setTarget }), [target, setTarget]);
  return <TabBarContext.Provider value={value}>{children}</TabBarContext.Provider>;
}

/**
 * Wrap each tab screen: full height on the ground colour, so content scrolls behind the bar. On
 * Android, when the binary has expo-blur's BlurTargetView, the scene is one and registers itself
 * as the blur target while focused; otherwise it is a plain View (never a missing native view).
 */
export function TabScene({ children }: { children: ReactNode }) {
  const Target = getBlurKit()?.BlurTargetView ?? null;
  const ref = useRef<ComponentRef<typeof View>>(null);
  const setTarget = useContext(TabBarContext)?.setTarget;
  useFocusEffect(
    useCallback(() => {
      if (Target) setTarget?.(ref);
    }, [Target, setTarget]),
  );
  if (!Target)
    return (
      <View style={styles.scene}>
        <Watermark />
        {children}
      </View>
    );
  return (
    <Target ref={ref} style={styles.scene}>
      <Watermark />
      {children}
    </Target>
  );
}

/** Fixed-duration ease-out: no spring tail, so it ends cleanly. */
const PILL_MS = 200;
const PILL_STRETCH = 0.35;
const PILL_TIMING = { duration: PILL_MS, easing: Easing.bezier(0.22, 1, 0.36, 1) };

/** Bar's distance from the bottom edge: above the home indicator / gesture bar, never flush. */
const barBottom = (safeBottom: number) => Math.max(safeBottom, spacing.sm) + layout.tabBarLift;

/**
 * Bottom padding for scroll content so the last item clears the floating bar (inside tabs) or
 * the safe area (pushed screens). Always ends with one section gap of air.
 */
export function useBottomSpace() {
  const insets = useSafeAreaInsets();
  const inTabs = useContext(TabBarContext) !== null;
  return inTabs
    ? barBottom(insets.bottom) + sizes.tabBar + layout.section
    : insets.bottom + layout.section;
}

/** iOS "Reduce Transparency" (Android always reports false). */
function useReduceTransparency() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((v) => alive && setOn(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setOn);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return on;
}

/**
 * The bar's background, never a native view the binary lacks:
 * - iOS with expo-blur in the binary: native blur + white wash.
 * - Android with ExpoBlurView + ExpoBlurTargetView: Dimezis blur of the focused scene.
 * - Otherwise (Expo Go or a build without expo-blur, or Android before the scene registers):
 *   "frosted" translucent white. iOS Reduce Transparency: solid white.
 */
function Glass() {
  const target = useContext(TabBarContext)?.target ?? null;
  const solid = useReduceTransparency();
  const kit = getBlurKit();
  if (solid) return <View style={[styles.fill, styles.solid]} />;
  const android = Platform.OS === 'android';
  if (!kit || !canBlur() || (android && !target)) {
    return <View style={[styles.fill, styles.fallback]} />;
  }
  const { BlurView } = kit;
  return (
    <BlurView
      key={android ? target?.id : undefined}
      tint={glass.tint}
      intensity={glass.intensity}
      blurMethod={android ? 'dimezisBlurView' : undefined}
      blurTarget={android ? target?.ref : undefined}
      style={[styles.fill, styles.round]}
    >
      <View style={[styles.fill, styles.tint]} />
    </BlurView>
  );
}

/**
 * Stitch Field Command bottom nav: floating frosted capsule, equal tabs, always-visible
 * labels, active tint = canopy teal, with a pill that springs to the selected tab.
 */
export function FloatingTabBar({
  state,
  emitter,
  navigateToTab,
  meta,
}: TabBarProps & { meta: Record<string, TabMeta> }) {
  const insets = useSafeAreaInsets();
  const routes = state.routes.filter((r) => meta[r.name]);
  const active = state.routes[state.index];
  const reduced = useReducedMotion();
  const [rowW, setRowW] = useState(0);
  const slot = routes.length > 0 ? rowW / routes.length : 0;
  const activeIdx = Math.max(
    0,
    routes.findIndex((r) => r.key === active?.key),
  );
  const x = useSharedValue(0);
  const from = useSharedValue(0);
  const dest = useSharedValue(0);

  function glide(to: number) {
    if (to === dest.value) return;
    from.value = x.value;
    dest.value = to;
    x.value = withTiming(to, PILL_TIMING);
  }
  function jump(to: number) {
    from.value = to;
    dest.value = to;
    x.value = to;
  }
  const placed = useRef(false);
  const pressAt = useRef(0);

  useEffect(() => {
    if (slot === 0) return;
    const to = activeIdx * slot;
    // First layout jumps; later changes (e.g. programmatic navigation) glide.
    if (!placed.current || reduced) jump(to);
    else glide(to);
    placed.current = true;
  }, [activeIdx, slot, reduced]);

  // Liquid stretch: the pill elongates mid-travel (sine of progress) and relaxes at both ends.
  const pillStyle = useAnimatedStyle(() => {
    const span = dest.value - from.value;
    const t = span === 0 ? 0 : Math.min(1, Math.max(0, (x.value - from.value) / span));
    const stretch =
      1 + PILL_STRETCH * Math.sin(Math.PI * t) * Math.min(1, Math.abs(span) / slot / 2);
    return { transform: [{ translateX: x.value }, { scaleX: stretch }] };
  });

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: barBottom(insets.bottom) }]}>
      <View style={styles.bar}>
        <Glass />
        <View
          style={styles.row}
          accessibilityRole="tablist"
          onLayout={(e) => setRowW(e.nativeEvent.layout.width)}
        >
          {slot > 0 ? (
            <Animated.View pointerEvents="none" style={[styles.pill, { width: slot }, pillStyle]} />
          ) : null}
          {routes.map((route) => {
            const m = meta[route.name];
            if (!m) return null;
            const focused = route.key === active?.key;
            const tint = focused ? colors.canopy : colors.subtle;

            // Start the pill on touch-down, before navigation and the next screen's render.
            function onPressIn() {
              if (focused || slot === 0) return;
              const to = routes.indexOf(route) * slot;
              if (reduced) jump(to);
              else glide(to);
              pressAt.current = Date.now();
            }

            function onPress() {
              Haptics.selectionAsync().catch(() => {});
              const event = emitter.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (focused || event.defaultPrevented) return;
              // Let the pill land first: mounting the next screen mid-glide is what made it hitch.
              const wait = reduced ? 0 : Math.max(0, PILL_MS - (Date.now() - pressAt.current));
              setTimeout(() => navigateToTab(route.key), wait);
            }

            return (
              <Pressable
                key={route.key}
                onPressIn={onPressIn}
                onPress={onPress}
                onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
                accessibilityRole="tab"
                accessibilityLabel={m.a11yLabel}
                accessibilityState={{ selected: focused }}
                style={styles.hit}
              >
                <View style={styles.tab}>
                  <Icon name={focused ? m.iconActive : m.icon} size={iconSize.md} color={tint} />
                  <Text
                    style={[styles.label, { color: tint }, focused && styles.labelOn]}
                    numberOfLines={1}
                    importantForAccessibility="no"
                  >
                    {m.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { flex: 1, backgroundColor: colors.ground },
  wrap: { position: 'absolute', left: layout.tabBarInset, right: layout.tabBarInset },
  bar: {
    height: sizes.tabBar,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    borderRadius: radius.full,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    boxShadow: shadows.floating,
    overflow: 'hidden',
  },
  fill: { ...StyleSheet.absoluteFill, borderRadius: radius.full },
  round: { overflow: 'hidden', borderCurve: 'continuous' },
  tint: { backgroundColor: colors.glassTint },
  solid: { backgroundColor: colors.surface },
  fallback: { backgroundColor: colors.glassFallback },
  row: { flexDirection: 'row', alignItems: 'center' },
  pill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    backgroundColor: colors.canopyPill,
  },
  hit: { flex: 1, minHeight: touch.min, justifyContent: 'center' },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 2,
  },
  label: { ...tabLabel, fontSize: 10, lineHeight: 12 },
  labelOn: {},
});
