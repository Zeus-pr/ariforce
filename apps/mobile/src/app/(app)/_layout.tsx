import { Stack } from 'expo-router';
import { AppHeader } from '@/components/app-header';
import { colors } from '@/theme';

/**
 * Signed-in area: the tab navigator, plus feature screens pushed over it. Pushed screens share
 * one header (AppHeader: back arrow + title, inset applied once), set here so they all match.
 * The tabs draw their own headers (same component), so the stack hides its header for "(tabs)".
 */
export default function AppLayout() {
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
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="coming-soon/[feature]" />
      <Stack.Screen name="masters/[kind]/index" />
      <Stack.Screen name="masters/[kind]/[id]" />
      <Stack.Screen name="masters/[kind]/form" />
      <Stack.Screen name="dcr/form" />
      <Stack.Screen name="tour-plan/form" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="leave/index" />
      <Stack.Screen name="leave/apply" />
      <Stack.Screen name="expenses/index" />
      <Stack.Screen name="expenses/[id]" />
      <Stack.Screen name="approvals/tp/[id]" />
      <Stack.Screen name="approvals/index" />
      <Stack.Screen name="approvals/dcr/[id]" />
    </Stack>
  );
}
