import * as Haptics from 'expo-haptics';
import type { Tabs } from 'expo-router';
import { createContext, useContext, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from './icon';
import { colors, layout, motion, radius, shadows, sizes, spacing, tabLabel, touch } from '@/theme';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

export type TabMeta = { label: string; icon: IconName; iconActive: IconName };

/** True inside the tab navigator, so screens know the floating bar covers their bottom edge. */
export const InTabsContext = createContext(false);

/** Bar's distance from the bottom edge: above the home indicator / gesture bar, never flush. */
const barBottom = (safeBottom: number) => Math.max(safeBottom, spacing.sm) + layout.tabBarLift;

/**
 * Bottom padding for scroll content so the last item clears the floating bar (inside tabs) or
 * the safe area (pushed screens). Always ends with one section gap of air.
 */
export function useBottomSpace() {
  const insets = useSafeAreaInsets();
  const inTabs = useContext(InTabsContext);
  return inTabs
    ? barBottom(insets.bottom) + sizes.tabBar + layout.section
    : insets.bottom + layout.section;
}

const ACTIVE_GROW = 2.4; // the active tab's share of the bar; the others get 1 each

/**
 * Floating capsule tab bar (CUTLY's approved "expanding capsule" pattern, in AriForce navy):
 * inset from the edges, fully rounded, soft shadow, lifted above the safe area. The active tab
 * widens into a navy pill with icon + label; the others show their icon only (and keep their
 * label for screen readers). Width and colour change as Reanimated CSS transitions (260 ms strong
 * ease-out), instant under Reduce Motion. Selection haptic on every tab press.
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

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: barBottom(insets.bottom) }]}>
      <View style={styles.bar} accessibilityRole="tablist">
        {state.routes.map((route, index) => {
          const m = meta[route.name];
          if (!m) return null;
          const focused = state.index === index;

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
                styles.slot,
                {
                  flexGrow: focused ? ACTIVE_GROW : 1,
                  transitionProperty: 'flexGrow',
                  transitionDuration: duration,
                  transitionTimingFunction: motion.cssEaseOut,
                },
              ]}
            >
              <Pressable
                onPress={onPress}
                onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
                accessibilityRole="tab"
                accessibilityLabel={m.label}
                accessibilityState={{ selected: focused }}
                style={styles.hit}
              >
                <Animated.View
                  style={[
                    styles.capsule,
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
                  {focused ? (
                    <Animated.Text
                      entering={reduced ? undefined : FadeIn.duration(motion.fast).delay(60)}
                      style={styles.label}
                      numberOfLines={1}
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
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: layout.tabBarInset, right: layout.tabBarInset },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: sizes.tabBar,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    boxShadow: shadows.floating,
  },
  slot: { flexBasis: 0, minWidth: touch.min },
  hit: { height: touch.min, justifyContent: 'center' },
  capsule: {
    height: touch.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  label: { ...tabLabel, color: colors.onNavy, flexShrink: 1 },
});
