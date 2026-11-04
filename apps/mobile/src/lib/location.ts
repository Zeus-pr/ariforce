/**
 * One-shot GPS fix for punch / visit / Presentation (no continuous tracking).
 */
import * as Location from 'expo-location';

export type GpsFix = {
  location: { lat: number; lng: number };
  accuracyM: number;
  capturedAt: string;
  isMock: boolean;
};

export async function getFix(): Promise<GpsFix> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location permission is required for punch-in and check-in.');
  }
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  const accuracy = pos.coords.accuracy;
  return {
    location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
    accuracyM: Math.min(10000, Math.round(accuracy != null && accuracy >= 0 ? accuracy : 100)),
    capturedAt: new Date(pos.timestamp).toISOString(),
    isMock: !!(pos.mocked ?? false),
  };
}
