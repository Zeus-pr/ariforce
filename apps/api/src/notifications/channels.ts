import type { Notification } from '@ariforce/contracts';

/**
 * Delivery channel (docs/NOTIFICATIONS.md "Channels"). `in_app` is the notifications row itself.
 * email / sms / push implement this later; the notify handler then creates notification_deliveries
 * rows and `notification.deliver` jobs for each registered external channel. No schema change.
 */
export interface NotificationChannel {
  readonly key: 'in_app' | 'email' | 'sms' | 'push';
  deliver(n: Notification, recipient: { userId: string; email: string | null }): Promise<void>;
}

/** External channels registered today: none (the user has not picked one yet). */
export const EXTERNAL_CHANNELS: NotificationChannel[] = [];
