import * as z from 'zod';
import { Id, Syncable, Timestamp } from './common';

export const DeviceOwnership = z.enum(['company', 'personal']).meta({ id: 'DeviceOwnership' });
export const DevicePlatform = z.enum(['android', 'ios']).meta({ id: 'DevicePlatform' });
export const DeviceStatus = z
  .enum(['pending_consent', 'active', 'revoked'])
  .meta({ id: 'DeviceStatus' });
export const ConsentPurpose = z
  .enum(['personal_device_enrolment', 'location_checkin'])
  .meta({ id: 'ConsentPurpose' });

export const Device = Syncable.extend({
  userId: Id,
  ownership: DeviceOwnership,
  platform: DevicePlatform,
  installId: z.string().max(100),
  model: z.string().max(100).nullable(),
  osVersion: z.string().max(40).nullable(),
  appVersion: z.string().max(40).nullable(),
  assetTag: z.string().max(60).nullable(),
  status: DeviceStatus,
  enrolledAt: Timestamp.nullable(),
}).meta({ id: 'Device' });
export type Device = z.infer<typeof Device>;

export const DeviceEnrol = Device.pick({
  ownership: true,
  platform: true,
  installId: true,
  model: true,
  osVersion: true,
  appVersion: true,
  assetTag: true,
}).meta({
  id: 'DeviceEnrol',
  description:
    'Personal phones stay `pending_consent` until both consents are granted; company phones are `active` immediately.',
});
export type DeviceEnrol = z.infer<typeof DeviceEnrol>;

export const ConsentGrant = z
  .object({
    purpose: ConsentPurpose,
    noticeVersion: z.string().max(40).meta({ description: 'Version of the DPDP notice shown' }),
    granted: z.boolean().meta({ description: 'false = withdrawal (append-only ledger)' }),
  })
  .meta({ id: 'ConsentGrant' });
export type ConsentGrant = z.infer<typeof ConsentGrant>;

export const ConsentRecord = ConsentGrant.extend({
  id: Id,
  userId: Id,
  deviceId: Id.nullable(),
  at: Timestamp,
}).meta({ id: 'ConsentRecord' });
export type ConsentRecord = z.infer<typeof ConsentRecord>;

/** Expo push token for this install. Null clears it. The token is not returned on Device. */
export const DevicePushToken = z
  .object({
    token: z.string().trim().min(1).max(200).nullable(),
  })
  .meta({ id: 'DevicePushToken' });
export type DevicePushToken = z.infer<typeof DevicePushToken>;

export const DevicePushTokenResult = z
  .object({ ok: z.literal(true) })
  .meta({ id: 'DevicePushTokenResult' });
export type DevicePushTokenResult = z.infer<typeof DevicePushTokenResult>;

export const GeoCaptureKind = z
  .enum(['punch_in', 'visit', 'punch_out', 'geo_tag'])
  .meta({ id: 'GeoCaptureKind' });
/** Point capture only (no continuous tracking). Sent with punch-in/visit/punch-out/geo-tag writes. */
export const GeoCapture = z
  .object({
    deviceId: Id,
    kind: GeoCaptureKind,
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().min(0).max(10000).nullable(),
    source: z.enum(['gps', 'network', 'fused', 'manual']),
    isMock: z.boolean(),
    capturedAt: Timestamp,
  })
  .meta({ id: 'GeoCapture' });
export type GeoCapture = z.infer<typeof GeoCapture>;
