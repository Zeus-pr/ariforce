/**
 * Expo Observe helpers — mark TTI after BrandSplash has fully dismissed.
 *
 * Local Metro (Expo Go) resolves `expo-observe` to `expo-observe-stub.js` so
 * ExpoAppMetrics is never loaded. EAS builds use the real native module.
 */
import { createContext, useContext, useEffect, type ComponentType } from 'react';

/** True once the in-app splash has finished its hide animation. */
export const SplashHiddenContext = createContext(false);

type ObserveModule = {
  Observe: {
    configure: (opts: { integrations: { 'expo-router': { filteredParams: string[] } } }) => void;
    markInteractive: () => void;
  };
  ObserveRoot: {
    wrap: (
      Component: ComponentType<Record<string, unknown>>,
    ) => ComponentType<Record<string, unknown>>;
  };
};

function observeNative(): ObserveModule {
  // Always require — Metro stubs this in Expo Go; EAS gets the real package.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-observe') as ObserveModule;
}

/** Call once at root before rendering. */
export function configureObserve() {
  observeNative().Observe.configure({
    integrations: {
      'expo-router': {
        filteredParams: ['id', 'claimId', 'lineId', 'name'],
      },
    },
  });
}

/** ObserveRoot.wrap when native Observe exists; identity via stub in Expo Go. */
export function wrapWithObserve(Component: ComponentType<object>): ComponentType<object> {
  return observeNative().ObserveRoot.wrap(
    Component as ComponentType<Record<string, unknown>>,
  ) as ComponentType<object>;
}

/** Call from every cold-start entry screen (sign-in + home). First call wins. */
export function useMarkObserveInteractive() {
  const splashHidden = useContext(SplashHiddenContext);

  useEffect(() => {
    if (!splashHidden) return;
    observeNative().Observe.markInteractive();
  }, [splashHidden]);
}
