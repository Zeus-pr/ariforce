/**
 * Field GPS: device/consent, punch, outlet lock, visit check-in.
 * Capture is mobile-only; web keeps view/manage.
 */
import type {
  AttendanceDay,
  CheckIn,
  CheckInCreate,
  ConsentState,
  Device,
} from '@ariforce/contracts';
import Constants from 'expo-constants';
import * as DeviceInfo from 'expo-device';
import { Alert, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { AuthUser } from './auth-api';
import { ApiError, apiFetch, idempotencyKey } from './api';
import type { PresentationCaptureDraft } from './dcr/adapter';
import { todayIST } from './dcr/dates';
import { getFix, type GpsFix } from './location';
import {
  doctorLockLimitReached,
  nearestLockMetres,
  shouldOfferAnotherChamber,
} from './outlet-lock';
import { dutyFromMeToday, fetchMeToday } from './me-today';
import { registerPush } from './push';
import { tokenStore } from './token-store';

export type { GpsFix };

/** Matches contracts OutletKind (doctor | chemist | stockist). */
export type OutletKind = 'doctor' | 'chemist' | 'stockist';

type Page<T> = { items: T[] };

/** Active GPS lock for an outlet (GET /v1/outlets/{kind}/{id}/locations). */
export type OutletLocation = {
  id: string;
  version: number;
  outletKind: OutletKind;
  outletId: string;
  label: string;
  location: { lat: number; lng: number };
  accuracyM: number | null;
  source: string;
  isMock: boolean;
  lockedAt: string;
  lockedBy: string;
  lockedByName?: string | null;
  active: boolean;
};

const LOCK_LABEL: Record<OutletKind, string> = {
  doctor: 'clinic',
  chemist: 'retail_shop',
  stockist: 'godown',
};

export const OUTLET_LOCK_LABELS: Record<OutletKind, { value: string; label: string }[]> = {
  doctor: [
    { value: 'clinic', label: 'Clinic' },
    { value: 'hospital', label: 'Hospital' },
    { value: 'chamber', label: 'Chamber' },
    { value: 'residence', label: 'Residence' },
    { value: 'nursing_home', label: 'Nursing home' },
    { value: 'other', label: 'Other' },
  ],
  chemist: [
    { value: 'retail_shop', label: 'Retail shop' },
    { value: 'distributor_counter', label: 'Distributor counter' },
    { value: 'other', label: 'Other' },
  ],
  stockist: [
    { value: 'godown', label: 'Godown' },
    { value: 'depot', label: 'Depot' },
    { value: 'office', label: 'Office' },
    { value: 'other', label: 'Other' },
  ],
};

export function outletLockLabelText(kind: OutletKind, value: string) {
  return OUTLET_LOCK_LABELS[kind].find((x) => x.value === value)?.label ?? value;
}

/** Plain copy for field API error codes. */
export function fieldErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'DEVICE_NOT_ACTIVE':
        return 'This device is not enrolled yet. Try again in a moment.';
      case 'CONSENT_REQUIRED':
        return 'Location consent is required before you can check in.';
      case 'SEQUENCE':
        // API: "Already punched in today" / "Punch in first" / "Already punched out today".
        // Visit path sets its own message via requireOnDuty — never rewrite punch errors here.
        return e.message || 'This check-in is out of order for today.';
      case 'NOT_PUNCHED_IN':
        return e.message || 'Punch in on Home before opening Presentation.';
      case 'OUT_OF_FENCE':
        return 'You are too far from this outlet. Move closer and try again.';
      case 'PRESENTATION_OUT_OF_FENCE':
        return 'You are too far from the locked location to open Presentation.';
      case 'OUTLET_NOT_LOCKED':
        return 'This outlet has no locked location yet. Check in again to lock it.';
      case 'LOW_ACCURACY':
        return 'GPS accuracy is too low. Step outside and try again.';
      case 'MOCK_LOCATION':
        return 'Mock locations are not allowed.';
      case 'CALL_NOT_CHECKED_IN':
        return 'Check in at this outlet before continuing.';
      case 'DCR_NOT_SUBMITTED':
        return e.message || 'Submit today’s DCR before punching out.';
      case 'LOCATION_EXISTS':
        return 'This outlet already has a locked location.';
      case 'LOCATION_LIMIT':
        return 'This doctor already has 5 locked places. Check in near one of them.';
      case 'IDEMPOTENCY_CONFLICT':
        return 'This check-in was already recorded differently. Refresh and retry.';
      default:
        return e.message;
    }
  }
  if (e instanceof Error) return e.message;
  return 'Something went wrong. Try again.';
}

export async function getConsent(): Promise<ConsentState> {
  return apiFetch<ConsentState>('/v1/me/consent');
}

/** Cached after the first successful enrol so punch does not re-hit /v1/me/consent every time. */
let cachedDeviceId: string | null | undefined;

/** Enrol personal device + grant required consents when the user cannot check in yet. */
export async function ensureFieldReady(): Promise<string | null> {
  if (cachedDeviceId !== undefined) {
    if (cachedDeviceId) void registerPush(cachedDeviceId);
    return cachedDeviceId;
  }
  const me = await getConsent();
  if (me.canCheckIn) {
    cachedDeviceId = me.deviceId;
    if (me.deviceId) void registerPush(me.deviceId);
    return me.deviceId;
  }
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const device = await apiFetch<Device>('/v1/devices', {
    method: 'POST',
    body: {
      ownership: 'personal',
      platform,
      installId: `mobile-${idempotencyKey()}`,
      model: DeviceInfo.modelName ?? null,
      osVersion: DeviceInfo.osVersion ?? null,
      appVersion: Constants.expoConfig?.version ?? null,
      assetTag: null,
    },
  });
  const noticeVersion = me.currentNoticeVersion || '2026-10-v1';
  for (const purpose of ['personal_device_enrolment', 'location_checkin'] as const) {
    await apiFetch(`/v1/devices/${device.id}/consents`, {
      method: 'POST',
      body: { purpose, granted: true, noticeVersion },
    });
  }
  cachedDeviceId = device.id;
  void registerPush(device.id);
  return device.id;
}

/**
 * Registers the Expo token on a device the user already has, or enrols one phone row when they
 * have none. Does not grant location consent and does not cache a pending device, so punch-in
 * still runs its own consent step.
 */
export async function registerPushIfEnrolled() {
  try {
    let id: string | null = typeof cachedDeviceId === 'string' ? cachedDeviceId : null;
    if (!id) {
      const me = await getConsent();
      id = me.deviceId;
      if (me.canCheckIn && me.deviceId) cachedDeviceId = me.deviceId;
    }
    if (!id) {
      const page = await apiFetch<Page<Device>>('/v1/devices');
      id = page.items.find((d) => d.status !== 'revoked')?.id ?? null;
    }
    if (!id) {
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      const existing = await SecureStore.getItemAsync('ariforce.install-id');
      const installId = existing ?? `mobile-${idempotencyKey()}`;
      if (!existing) await SecureStore.setItemAsync('ariforce.install-id', installId);
      const device = await apiFetch<Device>('/v1/devices', {
        method: 'POST',
        body: {
          ownership: 'personal',
          platform,
          installId,
          model: DeviceInfo.modelName ?? null,
          osVersion: DeviceInfo.osVersion ?? null,
          appVersion: Constants.expoConfig?.version ?? null,
          assetTag: null,
        },
      });
      id = device.id;
    }
    await registerPush(id);
  } catch {
    // Tried again the next time the app comes forward. The inbox still works without a token.
  }
}

function captureBody(fix: GpsFix, deviceId?: string | null) {
  return {
    clientId: idempotencyKey(),
    location: fix.location,
    accuracyM: fix.accuracyM,
    capturedAt: fix.capturedAt,
    isMock: fix.isMock,
    ...(deviceId ? { deviceId } : {}),
  };
}

/** Check-ins in an IST date range. Pass `userId` for one person; omit for the whole team. */
export async function listCheckInsInRange(
  from: string,
  to: string,
  userId?: string,
): Promise<CheckIn[]> {
  const page = await apiFetch<Page<CheckIn>>('/v1/check-ins', {
    query: { from, to, limit: 100, ...(userId ? { userId } : {}) },
  });
  return page.items ?? [];
}

/** Today's check-ins. Pass `userId` for one person; omit only for manager team lists. */
export async function listTodayCheckIns(userId?: string): Promise<CheckIn[]> {
  const day = todayIST();
  return listCheckInsInRange(day, day, userId);
}

/** One row per user-day from GET /v1/attendance. Pass `userId` for one person in your team. */
export async function listAttendanceDays(
  from: string,
  to: string,
  userId?: string,
): Promise<AttendanceDay[]> {
  const items: AttendanceDay[] = [];
  let cursor: string | undefined;
  for (let pageNo = 0; pageNo < 15; pageNo++) {
    const page = await apiFetch<{ items?: AttendanceDay[]; nextCursor?: string | null }>(
      '/v1/attendance',
      {
        query: {
          from,
          to,
          limit: 200,
          ...(userId ? { userId } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
    );
    items.push(...(page.items ?? []));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

/** Caller plus their reporting line (GET /v1/users). Company-wide roles get everyone. */
export async function listTeamPeople(): Promise<{ id: string; name: string; roles: string[] }[]> {
  const items: { id: string; name: string; roles: string[] }[] = [];
  let cursor: string | undefined;
  for (let pageNo = 0; pageNo < 10; pageNo++) {
    const page = await apiFetch<{
      items: { id: string; name: string; roles: string[] }[];
      nextCursor?: string | null;
    }>('/v1/users', {
      query: { status: 'active', sort: 'name', limit: 200, ...(cursor ? { cursor } : {}) },
    });
    items.push(...(page.items ?? []));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

/** Visit check-ins for one user today (Home daily target "done"). */
export async function countTodayVisits(userId: string): Promise<number> {
  const items = await listTodayCheckIns(userId);
  return items.filter((c) => c.kind === 'visit').length;
}

/** Google Maps at a check-in / lock point (managers open visit GPS). */
export function googleMapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** On duty when the latest punch_in is after any punch_out (caller-scoped items only). */
export function dutyFromCheckIns(items: CheckIn[]): {
  onDuty: boolean;
  punchedInAt: Date | null;
} {
  let lastIn: CheckIn | null = null;
  let lastOutAt = 0;
  for (const c of items) {
    const t = Date.parse(c.capturedAt);
    if (c.kind === 'punch_in' && (!lastIn || t >= Date.parse(lastIn.capturedAt))) lastIn = c;
    if (c.kind === 'punch_out' && t >= lastOutAt) lastOutAt = t;
  }
  const onDuty = !!lastIn && Date.parse(lastIn.capturedAt) > lastOutAt;
  return {
    onDuty,
    punchedInAt: onDuty && lastIn ? new Date(lastIn.capturedAt) : null,
  };
}

export async function postCheckIn(
  kind: CheckInCreate['kind'],
  opts: {
    fix?: GpsFix;
    outletKind?: OutletKind;
    outletId?: string;
    deviceId?: string | null;
  } = {},
): Promise<CheckIn> {
  const fix = opts.fix ?? (await getFix());
  const body: CheckInCreate = {
    ...captureBody(fix, opts.deviceId),
    kind,
    ...(kind === 'visit' ? { outletKind: opts.outletKind!, outletId: opts.outletId! } : {}),
  };
  return apiFetch<CheckIn>('/v1/check-ins', { method: 'POST', body });
}

export async function listOutletLocations(
  outletKind: OutletKind,
  outletId: string,
): Promise<OutletLocation[]> {
  const page = await apiFetch<Page<OutletLocation>>(
    `/v1/outlets/${outletKind}/${outletId}/locations`,
  );
  return (page.items ?? []).filter((x) => x.active);
}

/** ABM+ / system admin: change label or deactivate a wrong first lock. */
export async function patchOutletLocation(
  id: string,
  body: { version: number; label?: string; active?: boolean },
): Promise<OutletLocation> {
  return apiFetch<OutletLocation>(`/v1/outlet-locations/${id}`, {
    method: 'PATCH',
    body,
  });
}

/** The rep closed the “another chamber?” question. Check-in does not continue. */
export class CheckInCancelled extends Error {
  constructor() {
    super('Check-in cancelled');
    this.name = 'CheckInCancelled';
  }
}

async function createOutletLock(
  outletKind: OutletKind,
  outletId: string,
  fix: GpsFix,
  deviceId: string | null | undefined,
  label: string,
): Promise<string> {
  const lock = await apiFetch<OutletLocation>(`/v1/outlets/${outletKind}/${outletId}/locations`, {
    method: 'POST',
    body: {
      ...captureBody(fix, deviceId),
      label,
    },
  });
  return lock.id;
}

function confirmAnotherChamber(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Another chamber?',
      'You are away from this doctor’s saved locations. Lock this place as another chamber and check in here?',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Lock and check in', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Company visit fence, or this doctor’s own fence when one is set. */
async function visitRadiusM(outletKind: OutletKind, outletId: string): Promise<number | null> {
  try {
    const settings = await apiFetch<{ radiusM: number }>('/v1/settings/geofence');
    if (typeof settings.radiusM !== 'number') return null;
    if (outletKind !== 'doctor') return settings.radiusM;
    const doctor = await apiFetch<{ geofenceRadiusM?: number | null }>(
      `/v1/doctors/${outletId}`,
    ).catch(() => null);
    return typeof doctor?.geofenceRadiusM === 'number' ? doctor.geofenceRadiusM : settings.radiusM;
  } catch {
    return null;
  }
}

/** Punch in/out with device ready + GPS (consent and GPS in parallel). */
export async function punch(kind: 'punch_in' | 'punch_out'): Promise<CheckIn> {
  const [deviceId, fix] = await Promise.all([ensureFieldReady(), getFix()]);
  return postCheckIn(kind, { deviceId, fix });
}

/**
 * Open shift for this user today.
 * Prefers MeToday when it says `in`; otherwise uses this user's check-ins (last-in wins).
 * Live MeToday still treats any punch_out as `out` until the API fix is deployed.
 */
export async function getDutyState(): Promise<{
  onDuty: boolean;
  punchedInAt: Date | null;
}> {
  try {
    const d = dutyFromMeToday(await fetchMeToday());
    if (d.onDuty) return d;
  } catch {
    // Fall through.
  }
  const me = await tokenStore.getUser<AuthUser>().catch(() => null);
  if (!me?.id) return { onDuty: false, punchedInAt: null };
  return dutyFromCheckIns(await listTodayCheckIns(me.id));
}

export async function isOnDuty(): Promise<boolean> {
  return (await getDutyState()).onDuty;
}

/** True when this outlet has no active GPS lock yet (first check-in will create one). */
export async function outletNeedsFirstLock(
  outletKind: OutletKind,
  outletId: string,
): Promise<boolean> {
  return (await listOutletLocations(outletKind, outletId)).length === 0;
}

const dutyCacheKey = (userId: string, day: string) => `ariforce.duty.${userId}.${day}`;

/** Persist last known duty so Home survives reload before MeToday is fixed. */
export async function rememberDuty(onDuty: boolean, punchedInAt: Date | null) {
  const me = await tokenStore.getUser<AuthUser>().catch(() => null);
  if (!me?.id) return;
  await SecureStore.setItemAsync(
    dutyCacheKey(me.id, todayIST()),
    JSON.stringify({
      onDuty,
      punchedInAt: punchedInAt?.toISOString() ?? null,
    }),
  );
}

export async function readRememberedDuty(): Promise<{
  onDuty: boolean;
  punchedInAt: Date | null;
} | null> {
  const me = await tokenStore.getUser<AuthUser>().catch(() => null);
  if (!me?.id) return null;
  const raw = await SecureStore.getItemAsync(dutyCacheKey(me.id, todayIST())).catch(() => null);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { onDuty?: boolean; punchedInAt?: string | null };
    return {
      onDuty: !!v.onDuty,
      punchedInAt: v.punchedInAt ? new Date(v.punchedInAt) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Visit / Presentation require an open punch-in for the local day.
 * Throws ApiError SEQUENCE so fieldErrorMessage points the user to Home.
 */
export async function requireOnDuty(): Promise<void> {
  if (await isOnDuty()) return;
  throw new ApiError(409, 'SEQUENCE', 'Punch in on Home first, then check in at the call.');
}

/**
 * Visit check-in. The first pin is saved when the outlet has none.
 * A doctor standing outside every saved pin is asked before another chamber is locked.
 * Chemists and stockists keep one pin.
 */
export async function visitCheckIn(outletKind: OutletKind, outletId: string): Promise<string> {
  await requireOnDuty();
  const [deviceId, fix] = await Promise.all([ensureFieldReady(), getFix()]);
  const locks = await listOutletLocations(outletKind, outletId);
  let addedChamber = false;
  if (!locks.length) {
    await createOutletLock(outletKind, outletId, fix, deviceId, LOCK_LABEL[outletKind]);
  } else if (outletKind === 'doctor') {
    const radiusM = await visitRadiusM(outletKind, outletId);
    const nearestM = nearestLockMetres(fix.location, locks);
    if (radiusM != null && shouldOfferAnotherChamber(outletKind, nearestM, radiusM, locks.length)) {
      if (!(await confirmAnotherChamber())) throw new CheckInCancelled();
      await createOutletLock(outletKind, outletId, fix, deviceId, 'chamber');
      addedChamber = true;
    } else if (
      radiusM != null &&
      nearestM != null &&
      nearestM > radiusM &&
      doctorLockLimitReached(outletKind, locks.length)
    ) {
      throw new ApiError(
        409,
        'LOCATION_LIMIT',
        'This doctor already has 5 locked places. Check in near one of them.',
      );
    }
  }
  try {
    const visit = await postCheckIn('visit', { fix, outletKind, outletId, deviceId });
    // The company fence said "near", but this doctor's own fence said otherwise.
    if (outletKind === 'doctor' && !addedChamber && locks.length > 0 && visit.inFence === false) {
      if (!doctorLockLimitReached(outletKind, locks.length) && (await confirmAnotherChamber())) {
        await createOutletLock(outletKind, outletId, fix, deviceId, 'chamber');
      }
    }
    return visit.id;
  } catch (e) {
    if (
      addedChamber ||
      outletKind !== 'doctor' ||
      !locks.length ||
      !(e instanceof ApiError) ||
      e.code !== 'OUT_OF_FENCE'
    ) {
      throw e;
    }
    if (doctorLockLimitReached('doctor', locks.length)) {
      throw new ApiError(
        409,
        'LOCATION_LIMIT',
        'This doctor already has 5 locked places. Check in near one of them.',
      );
    }
    if (!(await confirmAnotherChamber())) throw e;
    await createOutletLock(outletKind, outletId, fix, deviceId, 'chamber');
    const visit = await postCheckIn('visit', { fix, outletKind, outletId, deviceId });
    return visit.id;
  }
}

/** GPS proof body for opening Presentation (attach to draft call). */
export async function capturePresentation(): Promise<PresentationCaptureDraft> {
  await requireOnDuty();
  const [deviceId, fix] = await Promise.all([ensureFieldReady(), getFix()]);
  return {
    ...captureBody(fix, deviceId),
  };
}
