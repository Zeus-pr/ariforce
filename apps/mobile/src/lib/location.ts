/**
 * One-shot GPS fix for punch / visit / Presentation (no continuous tracking).
 * Asks the OS for when-in-use location at first use — no separate in-app permissions screen.
 *
 * Speed: reuse a fresh last-known fix when it is good enough; otherwise take a High
 * one-shot (Highest waits many seconds indoors and is unnecessary vs the 200 m server cap).
 */
import * as Location from 'expo-location';
import { assertFieldDeviceIntegrity } from './device-integrity';
import { accuracyMetres } from './gps-accuracy';

export type GpsFix = {
  location: { lat: number; lng: number };
  accuracyM: number;
  capturedAt: string;
  isMock: boolean;
};

/** Prefer a cached fix younger than this (ms). */
const LAST_KNOWN_MAX_AGE_MS = 45_000;
/** Last-known must be at least this accurate (metres) to skip a new fix. */
const LAST_KNOWN_MAX_ACCURACY_M = 80;

function toFix(pos: Location.LocationObject): GpsFix {
  return {
    location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
    accuracyM: accuracyMetres(pos.coords.accuracy),
    capturedAt: new Date(pos.timestamp).toISOString(),
    isMock: !!(pos.mocked ?? false),
  };
}

async function ensurePermission() {
  const servicesOn = await Location.hasServicesEnabledAsync();
  if (!servicesOn) {
    throw new Error('Turn on Location Services, then try again.');
  }
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location permission is required for punch-in and check-in.');
  }
}

function rejectMock(fix: GpsFix): GpsFix {
  if (fix.isMock) {
    throw new Error('Mock locations are not allowed.');
  }
  return fix;
}

export async function getFix(): Promise<GpsFix> {
  await assertFieldDeviceIntegrity();
  await ensurePermission();

  const last = await Location.getLastKnownPositionAsync({
    maxAge: LAST_KNOWN_MAX_AGE_MS,
    requiredAccuracy: LAST_KNOWN_MAX_ACCURACY_M,
  });
  if (last) return rejectMock(toFix(last));

  // High ≈ 10 m — enough for geofence (server default maxAccuracyM 200).
  // mayShowUserSettingsDialog: Android high-accuracy mode when device is on battery saver.
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
    mayShowUserSettingsDialog: true,
  });
  return rejectMock(toFix(pos));
}
