# Field endpoints (attendance, check-ins, devices)

GPS is captured only at punch-in, visit and punch-out (stored in `geo_captures`; `clientId` is the row id).

## POST /v1/check-ins — rules in order

1. Same `clientId` already stored → `200` with the stored row (offline retry). Different user/kind → `409 IDEMPOTENCY_CONFLICT`.
2. Device: `deviceId`, or the user's single active device. None/inactive → `412 DEVICE_NOT_ACTIVE`.
3. Latest `location_checkin` consent must be granted → else `412 CONSENT_REQUIRED`.
4. `isMock` with `blockMockLocation` → `422 MOCK_LOCATION`; `accuracyM > maxAccuracyM` → `422 LOW_ACCURACY`.
5. Sequence per local day (company time zone, from `capturedAt`): one punch-in, punch-in before visit/punch-out, nothing after punch-out → `409 SEQUENCE`.
6. Visit outlet must be in the caller's territory scope → `404`.
7. Distance (haversine, metres) to the outlet geo-tag; radius = doctor override, else company default.
   Outside: `422 OUT_OF_FENCE` when `blockOutOfFence`, else stored with `inFence: false`.
   Untagged outlet: `distanceM`/`inFence` null.

`GET /v1/check-ins?unlinked=true` returns visit check-ins not referenced by any `dcr_calls.geo_capture_id` (DCR call picker, gap #9).
Read scope: caller + reporting line (`field:read`); `userId` outside the team → `403`.

## GET /v1/attendance

One row per team user per day, newest day first (`sort=date` for oldest first). Default range is today; max 62 days.
Status: `present` (punch-in + punch-out), `incomplete` (punch-in only), `leave`/`holiday` (the day's DCR work type,
else the approved tour plan's first session), else `absent`. There is no separate leave table yet.

## GET /v1/users

Team directory: the caller plus their reporting line; director and system admin see everyone. Filters `role`, `managerId`,
`territoryId` (subtree), `status`, `q`; sort `name`/`employeeCode`.

## Settings and devices

- `GET /v1/settings/geofence` (any user), `PUT` needs `settings:write` and the current `version` (`409` when stale).
  Backed by `companies.default_geofence_m` + migration 0011 columns.
- `POST /v1/devices`: company devices are active at once; personal devices stay `pending_consent` until both
  `personal_device_enrolment` and `location_checkin` are granted via `POST /v1/devices/{id}/consents`.
  Withdrawing enrolment consent revokes the device. `GET /v1/me/consent` reports `canCheckIn`.
