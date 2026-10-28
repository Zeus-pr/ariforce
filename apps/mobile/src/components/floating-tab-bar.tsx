import * as Haptics from 'expo-haptics';
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
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from './icon';
import { canBlur, getBlurKit } from '@/lib/blur';
import {
  colors,
  glass,
  iconSize,
  layout,
  motion,
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
  if (!Target) return <View style={styles.scene}>{children}</View>;
  return (
    <Target ref={ref} style={styles.scene}>
      {children}
    </Target>
  );
}

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
      // Android: remount when the focused scene changes so the blur re-binds to it.
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

// Active pill = padding + icon + gap + label. Roomy padding when it fits, compact otherwise.
const PILL_PAD = spacing.md;
const PILL_PAD_COMPACT = spacing.sm;
const pillWidth = (label: number, pad: number) => pad * 2 + iconSize.md + spacing.xs + label;

/**
 * Floating capsule tab bar (CUTLY's approved "expanding capsule", in AriForce navy): frosted
 * glass where the binary has a blur, translucent white elsewhere, inset from the sides, soft shadow, above the safe area. The active tab is a navy pill
 * sized to its measured label (never truncated); the other tabs share the rest equally, at
 * least 48 dp each. Widths animate as Reanimated CSS transitions (instant under Reduce Motion).
 * Selection haptic on every press.
 */
export function FloatingTabBar({
  state,
  emitter,
  navigateToTab,
  meta,
}: TabBarProps & { meta: Record<string, TabMeta> }) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const duration = reduced ? 0 : motion.base;
  const [barWidth, setBarWidth] = useState(0);
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});

  const routes = state.routes.filter((r) => meta[r.name]);
  const active = state.routes[state.index];
  const activeLabel = active ? labelWidths[active.name] : undefined;

  // Widths: the pill takes what its label needs (capped so every other tab keeps 48 dp); the
  // rest split evenly. Until measured, all tabs are equal and the label waits.
  const others = Math.max(routes.length - 1, 0);
  const maxPill = barWidth - others * touch.min;
  let pad: number = PILL_PAD;
  let pill = activeLabel != null ? pillWidth(activeLabel, PILL_PAD) : 0;
  if (pill > maxPill) {
    pad = PILL_PAD_COMPACT;
    pill = Math.min(pillWidth(activeLabel ?? 0, PILL_PAD_COMPACT), maxPill);
  }
  const measured = barWidth > 0 && activeLabel != null;
  const rest = others > 0 ? (barWidth - pill) / others : 0;

  const onBarLayout = (e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width);
  const onLabelLayout = (name: string) => (e: LayoutChangeEvent) => {
    const w = Math.ceil(e.nativeEvent.layout.width) + 1; // +1: sub-pixel slack
    setLabelWidths((m) => (m[name] === w ? m : { ...m, [name]: w }));
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: barBottom(insets.bottom) }]}>
      <View style={styles.bar}>
        <Glass />
        {/* Invisible copies of every label, to measure their width at the current font scale. */}
        <View
          style={styles.measure}
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
        >
          {routes.map((r) => (
            <Text
              key={r.key}
              style={styles.label}
              numberOfLines={1}
              onLayout={onLabelLayout(r.name)}
              accessibilityElementsHidden
            >
              {meta[r.name]?.label}
            </Text>
          ))}
        </View>

        <View style={styles.row} onLayout={onBarLayout} accessibilityRole="tablist">
          {routes.map((route) => {
            const m = meta[route.name];
            if (!m) return null;
            const focused = route.key === active?.key;
            const width = measured ? (focused ? pill : rest) : undefined;

            function onPress() {
              Haptics.selectionAsync().catch(() => {});
              const event = emitter.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) navigateToTab(route.key);
            }

            return (
              <Animated.View
                key={route.key}
                style={[
                  width == null ? styles.equal : { width },
                  {
                    transitionProperty: 'width',
                    transitionDuration: duration,
                    transitionTimingFunction: motion.cssEaseOut,
                  },
                ]}
              >
                <Pressable
                  onPress={onPress}
                  onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
                  accessibilityRole="tab"
                  accessibilityLabel={m.a11yLabel}
                  accessibilityState={{ selected: focused }}
                  style={styles.hit}
                >
                  <Animated.View
                    style={[
                      styles.capsule,
                      focused && { paddingHorizontal: pad },
                      {
                        backgroundColor: focused ? colors.navy : colors.navyClear,
                        transitionProperty: 'backgroundColor',
                        transitionDuration: duration,
                        transitionTimingFunction: motion.cssEaseOut,
                      },
                    ]}
                  >
                    <Icon
                      name={focused ? m.iconActive : m.icon}
                      color={focused ? colors.onNavy : colors.muted}
                    />
                    {focused && measured ? (
                      <Animated.Text
                        entering={reduced ? undefined : FadeIn.duration(motion.fast).delay(60)}
                        style={[styles.label, styles.labelOn]}
                        numberOfLines={1}
                        // Fallback only: the pill is sized to the label, so this rarely kicks in.
                        adjustsFontSizeToFit
                        minimumFontScale={0.85}
                        importantForAccessibility="no"
                      >
                        {m.label}
                      </Animated.Text>
                    ) : null}
                  </Animated.View>
                </Pressable>
              </Animated.View>
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
  // Shadow + border on the outer shape; the glass fills it and is clipped to the same radius.
  bar: {
    height: sizes.tabBar,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    borderRadius: radius.full,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    boxShadow: shadows.floating,
  },
  fill: { ...StyleSheet.absoluteFill, borderRadius: radius.full },
  round: { overflow: 'hidden', borderCurve: 'continuous' },
  tint: { backgroundColor: colors.glassTint },
  solid: { backgroundColor: colors.surface },
  fallback: { backgroundColor: colors.glassFallback },
  measure: { position: 'absolute', left: 0, top: 0, opacity: 0, alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center' },
  equal: { flex: 1 },
  hit: { height: touch.min, justifyContent: 'center' },
  capsule: {
    height: touch.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  label: { ...tabLabel, color: colors.ink },
  labelOn: { color: colors.onNavy, flexShrink: 1 },
});
