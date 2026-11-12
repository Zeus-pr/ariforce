/**
 * Metro stand-in for `expo-observe` / `expo-app-metrics` when the native modules
 * are missing (Expo Go). EAS builds resolve the real packages instead.
 */
'use strict';

function passthrough(Component) {
  return Component;
}

const Observe = {
  configure() {},
  markInteractive() {},
  setBundleDefaults() {},
};

module.exports = {
  Observe,
  default: Observe,
  AppMetrics: Observe,
  ObserveRoot: { wrap: passthrough },
  ObserveErrorBoundary: function ObserveErrorBoundary({ children }) {
    return children;
  },
  ObserveInteractiveMarker: function ObserveInteractiveMarker() {
    return null;
  },
  useObserve: () => Observe,
};
