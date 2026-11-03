import { Tabs } from 'expo-router';
import { Dimensions, Easing, View } from 'react-native';
import { AppHeader } from '@/components/app-header';
import { HeaderActions } from '@/components/header-actions';
import { useUnreadCount } from '@/lib/notifications';
import { FloatingTabBar, TabBarProvider, type TabMeta } from '@/components/floating-tab-bar';
import { LogoLockup } from '@/components/logo-lockup';
import { useAuth } from '@/lib/auth-context';
import { isSalesRole } from '@/lib/roles';
import { colors, motion, spacing } from '@/theme';

const SLIDE = Math.min(Dimensions.get('window').width, 480);

/** Just enough teal under the rounded white header — not a full canopy wash. */
const homeHeaderShell = {
  backgroundColor: colors.canopy,
  paddingBottom: spacing.sm,
} as const;

function HomeHeaderRight() {
  const { user } = useAuth();
  const name = user?.name?.trim() || user?.email || 'You';
  // Live unread count (GET /v1/notifications/unread-count, polled every minute).
  const unread = useUnreadCount().data ?? 0;
  return <HeaderActions name={name} unread={unread} />;
}

const TABS: Record<string, TabMeta> = {
  index: {
    label: 'Home',
    a11yLabel: 'Home',
    icon: 'home-variant-outline',
    iconActive: 'home-variant',
  },
  business: {
    label: 'Business',
    a11yLabel: 'Business',
    icon: 'briefcase-outline',
    iconActive: 'briefcase',
  },
  dcr: {
    label: 'DCR',
    a11yLabel: 'DCR',
    icon: 'clipboard-text-outline',
    iconActive: 'clipboard-text',
  },
  // Short word in the bar; screen readers and the screen title keep "Tour Plan".
  'tour-plan': {
    label: 'Tour Plan',
    a11yLabel: 'Tour Plan',
    icon: 'calendar-month-outline',
    iconActive: 'calendar-month',
  },
  more: {
    label: 'More',
    a11yLabel: 'More',
    icon: 'dots-horizontal',
    iconActive: 'dots-horizontal',
  },
};

/**
 * Bottom tabs on a floating frosted capsule bar. Each tab screen wraps its content in <TabScene>
 * so it scrolls behind the glass (and, on Android, is what the blur samples).
 */
export default function TabsLayout() {
  const { user } = useAuth();
  const sales = isSalesRole(user?.roles ?? []);
  // DCR is for the sales ladder only (web nav.ts SALES): no tab for System Admin.
  const meta = sales ? TABS : Object.fromEntries(Object.entries(TABS).filter(([k]) => k !== 'dcr'));
  return (
    <TabBarProvider>
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} meta={meta} />}
        screenOptions={{
          // Same AppHeader as pushed screens: one inset, one 56dp row, title on the gutter.
          header: ({ options, route }) => (
            <AppHeader title={typeof options.title === 'string' ? options.title : route.name} />
          ),
          sceneStyle: { backgroundColor: colors.ground },
          // Tabs slide horizontally in the direction of travel (progress is -1 / 0 / 1).
          sceneStyleInterpolator: ({ current }) => ({
            sceneStyle: {
              opacity: current.progress.interpolate({
                inputRange: [-1, -0.6, 0, 0.6, 1],
                outputRange: [0, 0.4, 1, 0.4, 0],
              }),
              transform: [
                {
                  translateX: current.progress.interpolate({
                    inputRange: [-1, 0, 1],
                    outputRange: [-SLIDE, 0, SLIDE],
                  }),
                },
              ],
            },
          }),
          transitionSpec: {
            animation: 'timing',
            config: { duration: motion.fast, easing: Easing.out(Easing.cubic) },
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            header: () => (
              // Thin teal lip above/below the white header so the bottom radius
              // reads against canopy — not a full-screen teal wash.
              <View style={homeHeaderShell}>
                <AppHeader
                  title="Home"
                  titleNode={<LogoLockup />}
                  right={<HomeHeaderRight />}
                  background={colors.surface}
                  roundBottom
                />
              </View>
            ),
          }}
        />
        <Tabs.Screen name="business" options={{ title: 'Business' }} />
        <Tabs.Screen name="dcr" options={{ title: 'DCR', href: sales ? undefined : null }} />
        <Tabs.Screen
          name="tour-plan"
          options={{ title: 'Tour Plan', href: sales ? undefined : null }}
        />
        <Tabs.Screen name="more" options={{ title: 'More' }} />
      </Tabs>
    </TabBarProvider>
  );
}
