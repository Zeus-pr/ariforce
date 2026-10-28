import Constants from 'expo-constants';

/**
 * API origin. Override per machine with EXPO_PUBLIC_API_URL in apps/mobile/.env.local
 * (git-ignored), e.g. http://10.0.2.2:4000 to hit a local API from the Android emulator.
 */
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  'https://ariforce-api.prajeshchoudhury.in'
).replace(/\/+$/, '');

/** better-auth is mounted under /v1/auth on the API (apps/api/src/auth/auth.ts AUTH_BASE_PATH). */
export const AUTH_URL = `${API_URL}/v1/auth`;
