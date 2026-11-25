// Metro in the pnpm monorepo: watch the repo root (workspace packages such as
// @ariforce/contracts) and resolve modules from this app first, then the root.
// Expo's default config already understands pnpm symlinks; this only makes the
// monorepo layout explicit.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...new Set([...(config.watchFolders ?? []), monorepoRoot])];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Expo Go has no ExpoAppMetrics / ExpoObserve / JailMonkey native modules. A JS
// `require` still evaluates those packages and redboxes even inside try/catch.
// Stub them for local Metro (Expo Go). Real packages on EAS: cloud sets
// EAS_BUILD=true, local `eas build --local` sets EAS_BUILD=1. Also when
// EXPO_OBSERVE_NATIVE=1 (dev client with natives).
const easBuild = process.env.EAS_BUILD;
const useNativeExtras =
  easBuild === 'true' || easBuild === '1' || process.env.EXPO_OBSERVE_NATIVE === '1';
if (!useNativeExtras) {
  const observeStub = path.resolve(projectRoot, 'src/lib/expo-observe-stub.js');
  const jailStub = path.resolve(projectRoot, 'src/lib/jail-monkey-stub.js');
  const prior = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (
      moduleName === 'expo-observe' ||
      moduleName === 'expo-app-metrics' ||
      moduleName.startsWith('expo-observe/') ||
      moduleName.startsWith('expo-app-metrics/')
    ) {
      return { type: 'sourceFile', filePath: observeStub };
    }
    if (moduleName === 'jail-monkey') {
      return { type: 'sourceFile', filePath: jailStub };
    }
    if (prior) return prior(context, moduleName, platform);
    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
