/**
 * Block the whole app on compromised devices (rooted / jailbroken / Developer options /
 * mockable / hooks). Native checks run only in EAS / dev-client binaries; Expo Go uses
 * a Metro stub that always passes (same pattern as expo-observe).
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import JailMonkey from 'jail-monkey';
import { Platform } from 'react-native';

export type DeviceBlockKind =
  'emulator' | 'rooted' | 'jailbroken' | 'hooks' | 'developer' | 'adb' | 'mock';

/** Copy + graphic cue for the full-screen block — never a native alert. */
export type DeviceBlockReason = {
  kind: DeviceBlockKind;
  /** Short witty line. */
  headline: string;
  /** Calm how-to, one or two sentences. */
  detail: string;
};

function isExpoGo() {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

/**
 * Returns a structured block reason when the device must not run AriForce, or `null` if OK.
 * Safe to call on resume — cheap sync checks + one Android settings read.
 */
export async function probeDeviceIntegrity(): Promise<DeviceBlockReason | null> {
  if (isExpoGo()) return null;

  if (!Device.isDevice && !__DEV__) {
    return {
      kind: 'emulator',
      headline: 'Nice try, virtual world',
      detail:
        'AriForce only runs on a real phone out in the field. Install the company build on your handset.',
    };
  }

  if (JailMonkey.isJailBroken()) {
    if (Platform.OS === 'ios') {
      return {
        kind: 'jailbroken',
        headline: 'This iPhone’s a little too free',
        detail: 'Jailbroken devices can’t use AriForce. Restore iOS, then open the app again.',
      };
    }
    return {
      kind: 'rooted',
      headline: 'Root access? We’re sitting this one out',
      detail: 'AriForce won’t run on a rooted phone. Use a stock device from the company fleet.',
    };
  }

  if (JailMonkey.hookDetected()) {
    return {
      kind: 'hooks',
      headline: 'Something’s tinkering under the hood',
      detail:
        'Apps that can fake GPS or modify AriForce were found. Remove them, then tap Check again.',
    };
  }

  if (Platform.OS === 'android') {
    const developerOn = await JailMonkey.isDevelopmentSettingsMode();
    if (developerOn) {
      return {
        kind: 'developer',
        headline: 'Developer mode is still on',
        detail:
          'Turn off Developer options in Settings → System, then tap Check again. Field work stays honest this way.',
      };
    }
    if (JailMonkey.AdbEnabled()) {
      return {
        kind: 'adb',
        headline: 'USB debugging is waving at us',
        detail: 'Switch off USB debugging in Developer options, then tap Check again.',
      };
    }
  }

  // Android canMockLocation scans every installed app for ACCESS_MOCK_LOCATION and
  // false-positives when "Select mock location app" is empty. Real spoofed fixes are
  // rejected in getFix via the OS mocked flag. iOS only flags a live simulated location.
  if (Platform.OS === 'ios' && JailMonkey.canMockLocation()) {
    return {
      kind: 'mock',
      headline: 'That pin looks a little staged',
      detail: 'A simulated location was detected. Turn it off, then tap Check again.',
    };
  }

  return null;
}

/** Throws when the device is blocked — second gate before GPS capture. */
export async function assertFieldDeviceIntegrity(): Promise<void> {
  const reason = await probeDeviceIntegrity();
  if (reason) throw new Error(`${reason.headline}. ${reason.detail}`);
}
