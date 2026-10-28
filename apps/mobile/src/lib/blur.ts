import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type ExpoGlobal = { expo?: { getViewConfig?: (module: string, view?: string) => unknown } };

/**
 * True only when this binary really has the native view (module registered AND its view config
 * present). Expo Go builds without expo-blur return false here instead of crashing at render with
 * "Can't find ViewManager 'ViewManagerAdapter_ExpoBlur_…'".
 */
function hasNativeView(moduleName: string, viewName: string) {
  try {
    if (requireOptionalNativeModule(moduleName) == null) return false;
    const g = globalThis as unknown as ExpoGlobal;
    return g.expo?.getViewConfig?.(moduleName, viewName) != null;
  } catch {
    return false;
  }
}

type ExpoBlur = typeof import('expo-blur');
export type BlurKit = {
  BlurView: ExpoBlur['BlurView'];
  /** Android only, and only when the binary has "ExpoBlurTargetView" (needed for a real blur). */
  BlurTargetView: ExpoBlur['BlurTargetView'] | null;
};

let cached: BlurKit | null | undefined;

/**
 * expo-blur's views, or null when this binary has no native ExpoBlurView (Expo Go builds without
 * it, or a dev build made before expo-blur was added). expo-blur is required lazily, only after
 * the native check passes, so nothing from it loads in a binary that lacks it.
 *
 * Android: a real blur also needs BlurTargetView around the content; if the binary lacks that
 * view, BlurTargetView is null and the tab bar uses its translucent fallback.
 */
export function getBlurKit(): BlurKit | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (!hasNativeView('ExpoBlur', 'ExpoBlurView')) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-blur') as ExpoBlur;
    const target =
      Platform.OS === 'android' && hasNativeView('ExpoBlur', 'ExpoBlurTargetView')
        ? mod.BlurTargetView
        : null;
    cached = { BlurView: mod.BlurView, BlurTargetView: target };
  } catch {
    cached = null;
  }
  return cached;
}

/** True when the tab bar can draw a real blur on this platform and binary. */
export function canBlur() {
  const kit = getBlurKit();
  if (!kit) return false;
  return Platform.OS === 'ios' || kit.BlurTargetView != null;
}
