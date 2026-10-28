import { Stack } from 'expo-router';
import { colors, fonts } from '@/theme';

/**
 * Signed-in area: the tab navigator, plus feature screens pushed over it with a native header and
 * back button. The tabs draw their own headers, so the stack hides its header for "(tabs)".
 */
export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.ground },
        headerTintColor: colors.navy,
        headerTitleStyle: { fontFamily: fonts.semibold, color: colors.ink },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.ground },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="coming-soon/[feature]" />
    </Stack>
  );
}
