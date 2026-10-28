import { Stack } from 'expo-router';
import { LogoLockup } from '@/components/logo-lockup';
import { colors } from '@/theme';

/** Signed-in area: native stack header carrying the brand lockup (no hand-rolled header). */
export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitle: () => <LogoLockup />,
        headerTitleAlign: 'left',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.ground },
        contentStyle: { backgroundColor: colors.ground },
      }}
    />
  );
}
