import { requireOptionalNativeModule } from 'expo';

type ScreenOrientationModule = typeof import('expo-screen-orientation');

let cached: ScreenOrientationModule | null | undefined;

/**
 * expo-screen-orientation, or null when this binary was built before it was added (like
 * lib/blur.ts). The JS package is required lazily, only after the native module is found, so an
 * older dev build never crashes; callers hide the rotate button instead.
 */
export function getScreenOrientation(): ScreenOrientationModule | null {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    if (requireOptionalNativeModule('ExpoScreenOrientation') != null)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cached = require('expo-screen-orientation') as ScreenOrientationModule;
  } catch {
    cached = null;
  }
  return cached;
}

/** The app is portrait; only the product presentation rotates. Safe without the native module. */
export async function lockPortrait() {
  const so = getScreenOrientation();
  if (!so) return;
  try {
    await so.lockAsync(so.OrientationLock.PORTRAIT_UP);
  } catch {
    // Not fatal: the manifest default still applies.
  }
}

export async function lockLandscape() {
  const so = getScreenOrientation();
  if (!so) return;
  try {
    await so.lockAsync(so.OrientationLock.LANDSCAPE);
  } catch {
    // ignore
  }
}
