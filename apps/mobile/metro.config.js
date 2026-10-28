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

module.exports = config;
