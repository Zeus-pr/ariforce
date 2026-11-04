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
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { AuthUser } from './auth-api';
import { ApiError, apiFetch, idempotencyKey } from './api';
import type { PresentationCaptureDraft } from './dcr/adapter';
import { todayIST } from './dcr/dates';
import { getFix, type GpsFix } from './location';
import { dutyFromMeToday, fetchMeToday } from './me-today';
import { tokenStore } from './token-store';

export type { GpsFix };

/** Matches contracts OutletKind (doctor | chemist | stockist). */
export type OutletKind = 'doctor' | 'chemist' | 'stockist';

type Page<T> = { items: T[] };

type OutletLocationRow = { id: string; active: boolean };

const LOCK_LABEL: Record<OutletKind, string> = {
  doctor: 'clinic',
  chemist: 'retail_shop',
  stockist: 'godown',
};

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

/** Enrol personal device + grant required consents when the user cannot check in yet. */
export async function ensureFieldReady(): Promise<string | null> {
  const me = await getConsent();
  if (me.canCheckIn) return me.deviceId;
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
  return device.id;
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

/** One row per user-day from GET /v1/attendance (team scope for approvers). */
export async function listAttendanceDays(from: string, to: string): Promise<AttendanceDay[]> {
  const page = await apiFetch<Page<AttendanceDay>>('/v1/attendance', {
    query: { from, to, limit: 200 },
  });
  return page.items ?? [];
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
): Promise<OutletLocationRow[]> {
  const page = await apiFetch<Page<OutletLocationRow>>(
    `/v1/outlets/${outletKind}/${outletId}/locations`,
  );
  return (page.items ?? []).filter((x) => x.active);
}

/** Create first lock at current fix when the outlet has none. */
export async function ensureOutletLocked(
  outletKind: OutletKind,
  outletId: string,
  fix?: GpsFix,
  deviceId?: string | null,
): Promise<string> {
  const existing = await listOutletLocations(outletKind, outletId);
  if (existing[0]) return existing[0].id;
  const gps = fix ?? (await getFix());
  const lock = await apiFetch<OutletLocationRow>(
    `/v1/outlets/${outletKind}/${outletId}/locations`,
    {
      method: 'POST',
      body: {
        ...captureBody(gps, deviceId),
        label: LOCK_LABEL[outletKind],
      },
    },
  );
  return lock.id;
}

/** Punch in/out with device ready + GPS. */
export async function punch(kind: 'punch_in' | 'punch_out'): Promise<CheckIn> {
  const deviceId = await ensureFieldReady();
  return postCheckIn(kind, { deviceId });
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

/** Visit check-in: on duty → field ready → lock if needed → visit. Returns check-in id. */
export async function visitCheckIn(outletKind: OutletKind, outletId: string): Promise<string> {
  await requireOnDuty();
  const deviceId = await ensureFieldReady();
  const fix = await getFix();
  await ensureOutletLocked(outletKind, outletId, fix, deviceId);
  const visit = await postCheckIn('visit', { fix, outletKind, outletId, deviceId });
  return visit.id;
}

/** GPS proof body for opening Presentation (attach to draft call). */
export async function capturePresentation(): Promise<PresentationCaptureDraft> {
  await requireOnDuty();
  const deviceId = await ensureFieldReady();
  const fix = await getFix();
  return {
    ...captureBody(fix, deviceId),
  };
}
