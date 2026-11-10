import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppHeader } from '@/components/app-header';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { registerPushIfEnrolled } from '@/lib/field';
import { notificationHref } from '@/lib/notifications';
import { listenForNotificationOpens } from '@/lib/push';
import { colors, layout, motion } from '@/theme';

/**
 * Signed-in area: the tab navigator, plus feature screens pushed over it. Pushed screens share
 * one header (AppHeader: back arrow + title, inset applied once), set here so they all match.
 * The tabs draw their own headers (same component), so the stack hides its header for "(tabs)".
 */
export default function AppLayout() {
  return (
    <View style={styles.backdrop}>
      <View style={styles.column}>
        <PushBridge />
        <AppStack />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', backgroundColor: colors.ground },
  // Tablets: one centred, readable column instead of stretching every screen edge to edge.
  column: { flex: 1, width: '100%', maxWidth: layout.maxContent },
});

function PushBridge() {
  const router = useRouter();
  useEffect(() => {
    void registerPushIfEnrolled();
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') void registerPushIfEnrolled();
    });
    const stop = listenForNotificationOpens((data) => {
      const href = notificationHref({
        type: typeof data.type === 'string' ? data.type : '',
        entityType: typeof data.entityType === 'string' ? data.entityType : null,
        entityId: typeof data.entityId === 'string' ? data.entityId : null,
        data: null,
      });
      router.push(href ?? '/notifications');
    });
    return () => {
      app.remove();
      stop();
    };
  }, [router]);
  return null;
}

function AppStack() {
  return (
    <Stack
      screenOptions={{
        header: ({ options, route, back, navigation }) => (
          <AppHeader
            title={typeof options.title === 'string' ? options.title : route.name}
            onBack={back ? () => navigation.goBack() : undefined}
          />
        ),
        contentStyle: { backgroundColor: colors.ground },
        // Native slide: iOS push with swipe-back, Android shared-axis style.
        animation: Platform.OS === 'ios' ? 'default' : 'slide_from_right',
        animationDuration: motion.base,
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="coming-soon/[feature]" />
      <Stack.Screen name="masters/[kind]/index" />
      <Stack.Screen name="masters/[kind]/[id]" />
      <Stack.Screen name="masters/[kind]/form" />
      <Stack.Screen name="products/index" options={{ title: 'Products' }} />
      {/* Edge swipe-back only: full-screen gesture steals the teal submit slider pan. */}
      <Stack.Screen name="dcr/form" options={{ fullScreenGestureEnabled: false }} />
      <Stack.Screen name="tour-plan/form" options={{ fullScreenGestureEnabled: false }} />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="company-message" options={{ title: 'Company message' }} />
      <Stack.Screen name="attendance/index" options={{ title: 'Attendance' }} />
      <Stack.Screen name="sales/index" options={{ title: 'Sales' }} />
      <Stack.Screen name="doctor-coverage" options={{ title: 'Coverage' }} />
      <Stack.Screen name="reports/index" options={{ title: 'Reports' }} />
      <Stack.Screen name="reports/activity" options={{ title: 'Field activity' }} />
      <Stack.Screen name="reports/products" options={{ title: 'Product detailing' }} />
      <Stack.Screen name="team/index" options={{ title: 'Team' }} />
      <Stack.Screen name="exceptions/index" options={{ title: 'Exceptions' }} />
      <Stack.Screen name="expense-reports/index" options={{ title: 'Expense report' }} />
      <Stack.Screen name="sfc/index" options={{ title: 'SFC' }} />
      <Stack.Screen name="signups/index" options={{ title: 'Sign-up requests' }} />
      <Stack.Screen name="my-team/index" options={{ title: 'My team' }} />
      <Stack.Screen name="people/index" options={{ title: 'People' }} />
      <Stack.Screen name="leave/index" />
      <Stack.Screen name="leave/apply" />
      <Stack.Screen name="expenses/index" />
      <Stack.Screen name="expenses/new" />
      <Stack.Screen name="expenses/[id]" />
      <Stack.Screen name="approvals/tp/[id]" />
      <Stack.Screen name="approvals/index" />
      <Stack.Screen name="approvals/dcr/[id]" />
      <Stack.Screen name="team-field/index" options={{ title: 'Team field' }} />
      <Stack.Screen name="pob/index" options={{ title: 'POB' }} />
    </Stack>
  );
}
