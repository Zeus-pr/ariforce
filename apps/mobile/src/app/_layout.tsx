import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import GoogleSansBold from '../../assets/fonts/GoogleSans-Bold.ttf';
import GoogleSansMedium from '../../assets/fonts/GoogleSans-Medium.ttf';
import GoogleSansRegular from '../../assets/fonts/GoogleSans-Regular.ttf';
import GoogleSansSemiBold from '../../assets/fonts/GoogleSans-SemiBold.ttf';
import { BrandSplash } from '@/components/brand-splash';
import { DeviceBlocked } from '@/components/device-blocked';
import { iconFont } from '@/components/icon';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { probeDeviceIntegrity, type DeviceBlockReason } from '@/lib/device-integrity';
import { lockPortrait } from '@/lib/orientation';
import { configureObserve, SplashHiddenContext, wrapWithObserve } from '@/lib/observe';
import { queryClient } from '@/lib/query-client';
import { colors, fonts, motion } from '@/theme';

// Before any screen mounts — no-op in Expo Go (no ExpoAppMetrics native module).
configureObserve();

// Keep the native splash (same mark, same ground) up until the in-app splash has painted its
// identical mark (BrandSplash onReady), then cross-fade: nothing visible changes at the hand-off.
// The in-app splash stays until the stored session has been checked.
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 150, fade: true });
// The app is portrait (app.json allows rotation only so the presentation can lock landscape).
void lockPortrait();

const hideNativeSplash = () => {
  SplashScreen.hideAsync().catch(() => {});
};

/**
 * Navigation theme on the app's colours, so nothing navigation draws (screen and card
 * backgrounds, borders) falls back to React Navigation's grey #F2F2F2.
 */
const NAV_THEME = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.navy,
    background: colors.ground,
    card: colors.ground,
    text: colors.ink,
    border: colors.separator,
  },
};

function RootLayout() {
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

export default wrapWithObserve(RootLayout);

function useDeviceIntegrityGate() {
  const [blocked, setBlocked] = useState<DeviceBlockReason | null>(null);
  const [ready, setReady] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  const run = useCallback(async () => {
    const reason = await probeDeviceIntegrity();
    setBlocked(reason);
    setReady(true);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void run();
    });
    return () => sub.remove();
  }, [run]);

  const recheck = useCallback(async () => {
    setRechecking(true);
    try {
      await run();
    } finally {
      setRechecking(false);
    }
  }, [run]);

  return { ready, blocked, rechecking, recheck };
}

function RootNavigator() {
  const { status } = useAuth();
  const integrity = useDeviceIntegrityGate();
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
  const [splashReady, setSplashReady] = useState(false);
  const fontsReady = fontsLoaded || !!fontError || fontTimeout;
  const isBlocked = integrity.ready && integrity.blocked != null;

  useEffect(() => {
    const a = setTimeout(() => setFontTimeout(true), motion.fontFailsafe);
    const b = setTimeout(() => setMinElapsed(true), motion.splashMin);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);

  const onSplashHidden = useCallback(() => setSplashGone(true), []);
  const onSplashReady = useCallback(() => {
    hideNativeSplash();
    setSplashReady(true);
  }, []);
  const signedIn = status === 'signed-in';
  // Hold splash until integrity has resolved so a blocked device never flashes sign-in.
  const bootReady = fontsReady && splashReady && integrity.ready;

  // The BrandSplash mark is the very first thing React draws (even before fonts), exactly over
  // the launch window's mark. The app mounts under it only once that mark is painted.
  return (
    <SplashHiddenContext.Provider value={splashGone}>
      <StatusBar style="dark" />
      {bootReady &&
        (isBlocked && integrity.blocked ? (
          <DeviceBlocked
            reason={integrity.blocked}
            onRecheck={() => void integrity.recheck()}
            checking={integrity.rechecking}
          />
        ) : (
          <ThemeProvider value={NAV_THEME}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.ground },
              }}
            >
              <Stack.Protected guard={signedIn}>
                <Stack.Screen name="(app)" />
              </Stack.Protected>
              <Stack.Protected guard={!signedIn}>
                <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
              </Stack.Protected>
            </Stack>
          </ThemeProvider>
        ))}
      {!splashGone && (
        <BrandSplash
          done={bootReady && minElapsed && (isBlocked || status !== 'loading')}
          showWords={fontsReady}
          onReady={onSplashReady}
          onHidden={onSplashHidden}
        />
      )}
    </SplashHiddenContext.Provider>
  );
}
