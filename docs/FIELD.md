# Field endpoints (attendance, check-ins, devices, outlet locks)

GPS is captured only at punch-in, visit, punch-out and outlet geo-tag (stored in `geo_captures`; `clientId` is the row id).
Outlet locks live in `outlet_locations` (doctors: many; chemists/stockists: one active). Presentation is hard-gated to
`companies.presentation_geofence_m` (default 300 m) of a locked location.

## POST /v1/check-ins — rules in order

1. Same `clientId` already stored → `200` with the stored row (offline retry). Different user/kind → `409 IDEMPOTENCY_CONFLICT`.
2. Device: `deviceId`, or the user's single active device. None/inactive → `412 DEVICE_NOT_ACTIVE`.
3. Latest `location_checkin` consent must be granted → else `412 CONSENT_REQUIRED`.
4. `isMock` with `blockMockLocation` → `422 MOCK_LOCATION`; `accuracyM > maxAccuracyM` → `422 LOW_ACCURACY`.
5. Sequence per local day (company time zone, from `capturedAt`): one punch-in, punch-in before visit/punch-out, nothing after punch-out → `409 SEQUENCE`.
   Temp testing: `FIELD_RELAX_PUNCH_SEQUENCE=1` skips the “already punched in” / “already punched out” blocks (still requires punch-in before visit/punch-out).
   5b. `punch_out` also requires today’s DCR **submitted** or **approved** → else `409 DCR_NOT_SUBMITTED`.
   5c. Open punches on **prior** local days are auto-closed with a system `punch_out` (`source: manual`, end of that local day) on the next `punch_in` or `GET /v1/me/today` (covers IST midnight without a separate cron).
6. Visit outlet must be in the caller's territory scope → `404`.
7. Distance (haversine, metres) to the **nearest active** `outlet_locations` row (else the master `location`);
   radius = doctor override, else company default. Outside: `422 OUT_OF_FENCE` when `blockOutOfFence`, else
   stored with `inFence: false`. Untagged outlet: `distanceM`/`inFence` null.

`GET /v1/check-ins?unlinked=true` returns visit check-ins not referenced by any `dcr_calls.geo_capture_id` (DCR call picker, gap #9).
Read scope: caller + reporting line (`field:read`); `userId` outside the team → `403`.

## Outlet locations (lock)

- `GET /v1/outlets/{kind}/{id}/locations` — active locks (`field:read`).
- `POST /v1/outlets/{kind}/{id}/locations` — first lock / add (`field:write`). Idempotent on `clientId`.
  Accuracy must be ≤ `lockMaxAccuracyM` (default 80). Chemist/stockist: `409 LOCATION_EXISTS` if one is already active.
  Doctor labels: `clinic|hospital|chamber|residence|nursing_home|other`. A doctor may have 5 active pins;
  a sixth lock is `409 LOCATION_LIMIT`. Chemist: `retail_shop|distributor_counter|other`.
  Stockist: `godown|depot|office|other`.
- `PATCH /v1/outlet-locations/{id}` — ABM→Director and system_admin only (403 for BM). Edit label/coords or deactivate.
  Append-only `geo_lock_events` + audit.

## Call check-in + Presentation (DCR)

1. **Visit check-in** (`POST /v1/check-ins` kind `visit`) at the outlet, then set `DcrCallInput.checkInId`.
2. **Submit** requires every field call to have `checkInId` (422 `VALIDATION` / `CALL_NOT_CHECKED_IN`).
3. **Presentation** (doctor, products detailed): when a call **newly** sets `presentationOpenedAt`, the call
   must already have a linked visit (`checkInId` or saved `geo_capture_id`) else `CALL_NOT_CHECKED_IN`,
   and the body must include `presentationCapture`. Server also requires punch-in that day, an active
   lock, and distance ≤ `presentationRadiusM` (`NOT_PUNCHED_IN` / `OUTLET_NOT_LOCKED` /
   `PRESENTATION_OUT_OF_FENCE` / `PRESENTATION_CAPTURE_REQUIRED`). Stores
   `presentationLocationId` / `presentationDistanceM` / `presentationAccuracyM`. Re-saves keep an
   existing presentation without re-sending GPS. Chemist/stockist: check-in only (no presentation).

## GET /v1/attendance

One row per team user per day, newest day first (`sort=date` for oldest first). Default range is today; max 62 days.
Status: `present` (punch-in + punch-out), `incomplete` (punch-in only), `leave`/`holiday` (the day's DCR work type,
else the approved tour plan's first session), else `absent`. There is no separate leave table yet.

## GET /v1/users

Team directory: the caller plus their reporting line; director and system admin see everyone. Filters `role`, `managerId`,
`territoryId` (subtree), `status`, `q`; sort `name`/`employeeCode`.

## Settings and devices

- `GET /v1/settings/geofence` (any user), `PUT` needs `settings:write` and the current `version` (`409` when stale).
  Includes `radiusM`, `maxAccuracyM`, `blockOutOfFence`, `blockMockLocation`, `presentationRadiusM`, `lockMaxAccuracyM`.
- `POST /v1/devices`: company devices are active at once; personal devices stay `pending_consent` until both
  `personal_device_enrolment` and `location_checkin` are granted via `POST /v1/devices/{id}/consents`.
  Withdrawing enrolment consent revokes the device. `GET /v1/me/consent` reports `canCheckIn`.
