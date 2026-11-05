/**
 * Expo Observe helpers — mark TTI after BrandSplash has fully dismissed.
 *
 * Expo Go does not ship ExpoAppMetrics. Never import/require `expo-observe` there
 * (its entry re-exports expo-app-metrics, which throws on load). Dev/EAS builds keep Observe.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { createContext, useContext, useEffect, type ComponentType } from 'react';

/** True once the in-app splash has finished its hide animation. */
export const SplashHiddenContext = createContext(false);

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type ObserveModule = typeof import('expo-observe');

function observeNative(): ObserveModule | null {
  if (isExpoGo) return null;
  // Lazy require: Metro still bundles it, but Expo Go never evaluates the native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-observe') as ObserveModule;
}

/** Call once at root before rendering. No-op in Expo Go. */
export function configureObserve() {
  const mod = observeNative();
  if (!mod) return;
  mod.Observe.configure({
    integrations: {
      'expo-router': {
        filteredParams: ['id', 'claimId', 'lineId', 'name'],
      },
    },
  });
}

/** Identity wrap in Expo Go; ObserveRoot.wrap in native builds. */
export function wrapWithObserve(Component: ComponentType<object>): ComponentType<object> {
  const mod = observeNative();
  if (!mod) return Component;
  // ObserveRoot.wrap is typed against Record<string, unknown>; root layout has no props.
  return mod.ObserveRoot.wrap(
    Component as ComponentType<Record<string, unknown>>,
  ) as ComponentType<object>;
}

/** Call from every cold-start entry screen (sign-in + home). First call wins. */
export function useMarkObserveInteractive() {
  const splashHidden = useContext(SplashHiddenContext);

  useEffect(() => {
    if (!splashHidden) return;
    const mod = observeNative();
    if (!mod) return;
    mod.Observe.markInteractive();
  }, [splashHidden]);
}
