import { Tabs } from 'expo-router';
import { HeaderActions } from '@/components/header-actions';
import { FloatingTabBar, TabBarProvider, type TabMeta } from '@/components/floating-tab-bar';
import { LogoLockup } from '@/components/logo-lockup';
import { useAuth } from '@/lib/auth-context';
import { getHomeMock } from '@/mocks/home';
import { colors, fonts } from '@/theme';

function HomeHeaderRight() {
  const { user } = useAuth();
  const name = user?.name?.trim() || user?.email || 'You';
  // PLACEHOLDER: unread count = open flags from the mock until notifications are wired.
  const unread = getHomeMock(new Date()).attention.length;
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
    label: 'Plans',
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
  return (
    <TabBarProvider>
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} meta={TABS} />}
        screenOptions={{
          headerStyle: { backgroundColor: colors.ground },
          headerShadowVisible: false,
          headerTitleAlign: 'left',
          headerTitleStyle: { fontFamily: fonts.semibold, color: colors.ink },
          sceneStyle: { backgroundColor: colors.ground },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            headerTitle: () => <LogoLockup />,
            headerRight: () => <HomeHeaderRight />,
          }}
        />
        <Tabs.Screen name="business" options={{ title: 'Business' }} />
        <Tabs.Screen name="dcr" options={{ title: 'DCR' }} />
        <Tabs.Screen name="tour-plan" options={{ title: 'Tour Plan' }} />
        <Tabs.Screen name="more" options={{ title: 'More' }} />
      </Tabs>
    </TabBarProvider>
  );
}
