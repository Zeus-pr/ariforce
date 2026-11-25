/**
 * Metro stand-in for `jail-monkey` when the native module is not in the binary
 * (Expo Go / local Metro). Real package is linked on EAS (`EAS_BUILD=true`).
 * Checks are skipped in Expo Go — integrity only applies to production builds.
 */
const api = {
  jailBrokenMessage: () => '',
  isJailBroken: () => false,
  hookDetected: () => false,
  isDebuggedMode: async () => false,
  canMockLocation: () => false,
  trustFall: () => false,
  isOnExternalStorage: () => false,
  AdbEnabled: () => false,
  isDevelopmentSettingsMode: async () => false, // Expo Go: do not block local testing
};

module.exports = api;
module.exports.default = api;
