import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import GoogleSansBold from '../../assets/fonts/GoogleSans-Bold.ttf';
import GoogleSansMedium from '../../assets/fonts/GoogleSans-Medium.ttf';
import GoogleSansRegular from '../../assets/fonts/GoogleSans-Regular.ttf';
import GoogleSansSemiBold from '../../assets/fonts/GoogleSans-SemiBold.ttf';
import { BrandSplash } from '@/components/brand-splash';
import { iconFont } from '@/components/icon';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { queryClient } from '@/lib/query-client';
import { colors, fonts, motion } from '@/theme';

// Keep the native splash (same mark, same ground) until fonts are ready, then hand over to the
// in-app splash, which stays until the stored session has been checked.
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 200, fade: true });

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <RootNavigator />
            </AuthProvider>
          </QueryClientProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { status } = useAuth();
  const [fontsLoaded, fontError] = useFonts({
    [fonts.regular]: GoogleSansRegular,
    [fonts.medium]: GoogleSansMedium,
    [fonts.semibold]: GoogleSansSemiBold,
    [fonts.bold]: GoogleSansBold,
    ...iconFont,
  });
  // CUTLY: never hold launch hostage to fonts; fall back to system type after 2.5s.
  const [fontTimeout, setFontTimeout] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);
  const [splashGone, setSplashGone] = useState(false);
  const fontsReady = fontsLoaded || !!fontError || fontTimeout;

  useEffect(() => {
    const a = setTimeout(() => setFontTimeout(true), motion.fontFailsafe);
    const b = setTimeout(() => setMinElapsed(true), motion.splashMin);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);

  useEffect(() => {
    if (fontsReady) SplashScreen.hideAsync().catch(() => {});
  }, [fontsReady]);

  const onSplashHidden = useCallback(() => setSplashGone(true), []);
  const signedIn = status === 'signed-in';

  if (!fontsReady) return null;

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
        </Stack.Protected>
      </Stack>
      {!splashGone && (
        <BrandSplash done={minElapsed && status !== 'loading'} onHidden={onSplashHidden} />
      )}
    </>
  );
}
