import * as Haptics from 'expo-haptics';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { HeaderActions } from '@/components/header-actions';
import { Icon, type IconName } from '@/components/icon';
import { LogoLockup } from '@/components/logo-lockup';
import { useAuth } from '@/lib/auth-context';
import { getHomeMock } from '@/mocks/home';
import { colors, fonts, spacing, tabLabel } from '@/theme';

function tabIcon(active: IconName, idle: IconName) {
  function TabIcon({
    color,
    size,
    focused,
  }: {
    color: ColorValue | null;
    size: number;
    focused: boolean;
  }) {
    // Tab tints are theme strings; anything else falls back to the Icon default.
    return (
      <Icon
        name={focused ? active : idle}
        color={typeof color === 'string' ? color : null}
        size={size}
      />
    );
  }
  return TabIcon;
}

function HomeHeaderRight() {
  const { user } = useAuth();
  const name = user?.name?.trim() || user?.email || 'You';
  // PLACEHOLDER: unread count = open flags from the mock until notifications are wired.
  const unread = getHomeMock(new Date()).attention.length;
  return <HeaderActions name={name} unread={unread} />;
}

/** Bottom tabs, as on the website's main areas. Non-Home tabs are stubs for now. */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.ground },
        headerShadowVisible: false,
        headerTitleAlign: 'left',
        headerTitleStyle: { fontFamily: fonts.semibold, color: colors.ink },
        headerLeftContainerStyle: { paddingLeft: spacing.sm },
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: tabLabel,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.separator },
        sceneStyle: { backgroundColor: colors.ground },
      }}
      screenListeners={{
        tabPress: () => {
          Haptics.selectionAsync().catch(() => {});
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerTitle: () => <LogoLockup />,
          headerRight: () => <HomeHeaderRight />,
          tabBarIcon: tabIcon('home-variant', 'home-variant-outline'),
        }}
      />
      <Tabs.Screen
        name="business"
        options={{ title: 'Business', tabBarIcon: tabIcon('briefcase', 'briefcase-outline') }}
      />
      <Tabs.Screen
        name="dcr"
        options={{ title: 'DCR', tabBarIcon: tabIcon('clipboard-text', 'clipboard-text-outline') }}
      />
      <Tabs.Screen
        name="tour-plan"
        options={{
          title: 'Tour Plan',
          tabBarIcon: tabIcon('calendar-month', 'calendar-month-outline'),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: tabIcon('dots-horizontal', 'dots-horizontal') }}
      />
    </Tabs>
  );
}
