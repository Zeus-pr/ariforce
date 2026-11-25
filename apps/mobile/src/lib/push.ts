import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { apiFetch } from './api';

let registeredFor: string | null = null;

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch {
  // Expo Go has no remote-notification native module. The in-app list still works.
}

/** Saves this install's Expo token on the device row. Safe to call more than once. */
export async function registerPush(deviceId: string) {
  if (registeredFor === deviceId) return;
  if (!Device.isDevice) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'AriForce',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const projectId =
      Constants.easConfig?.projectId ??
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    if (!projectId) return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (!token) return;
    await apiFetch(`/v1/devices/${deviceId}/push-token`, { method: 'POST', body: { token } });
    registeredFor = deviceId;
  } catch {
    // Remote banners need a production build. The inbox does not.
  }
}

/** Opens the screen for a tapped banner, including one that launched the app. */
export function listenForNotificationOpens(onOpen: (data: Record<string, unknown>) => void) {
  let lastId: string | null = null;
  const open = (response: Notifications.NotificationResponse | null) => {
    if (!response || response.notification.request.identifier === lastId) return;
    lastId = response.notification.request.identifier;
    const data = response.notification.request.content.data;
    onOpen(data && typeof data === 'object' ? (data as Record<string, unknown>) : {});
  };
  const sub = Notifications.addNotificationResponseReceivedListener(open);
  void Notifications.getLastNotificationResponseAsync()
    .then(open)
    .catch(() => {});
  return () => sub.remove();
}
