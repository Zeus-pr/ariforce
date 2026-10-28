import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * API origin (CUTLY lesson 13: keep emulator and device URLs apart).
 *
 * - Default: the live API from app.json `extra.apiUrl`, reachable from emulator and phones alike.
 * - EXPO_PUBLIC_API_URL in apps/mobile/.env.local (git-ignored; Expo only reads personal values
 *   from *.local files) overrides it for physical devices, e.g. the Mac's LAN IP.
 * - EXPO_PUBLIC_API_URL_ANDROID_EMULATOR overrides it on the Android emulator only, e.g.
 *   http://10.0.2.2:4000. A localhost/127.0.0.1 URL is rewritten to 10.0.2.2 on the emulator,
 *   because "localhost" there is the emulator itself, not the Mac.
 */
const isAndroidEmulator = Platform.OS === 'android' && !Device.isDevice;

function pick(): string {
  const fromConfig = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  const base =
    (isAndroidEmulator && process.env.EXPO_PUBLIC_API_URL_ANDROID_EMULATOR) ||
    process.env.EXPO_PUBLIC_API_URL ||
    fromConfig ||
    'https://ariforce-api.prajeshchoudhury.in';
  const url = base.replace(/\/+$/, '');
  return isAndroidEmulator
    ? url.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/, '//10.0.2.2')
    : url;
}

export const API_URL = pick();

/** better-auth is mounted under /v1/auth (apps/api/src/auth/auth.ts AUTH_BASE_PATH). */
export const AUTH_URL = `${API_URL}/v1/auth`;
