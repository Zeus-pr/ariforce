# API conventions (v1)

Source of truth: zod schemas in `packages/contracts`. The OpenAPI 3.1 document is generated from them
(`pnpm -F @ariforce/contracts openapi`), committed at `docs/api/openapi.json`, served by the API at
`GET /openapi.json`, and browsable at `GET /docs` (Scalar). CI fails if the committed file is stale.

## Versioning

- All endpoints live under `/v1`. Breaking changes go to `/v2`; additive changes (new optional fields, new endpoints) stay in `/v1`.
- Clients must ignore unknown fields.

## Auth

- better-auth, mounted at `/v1/auth/*` (`POST /v1/auth/sign-in/email`, `POST /v1/auth/sign-out`, `GET /v1/auth/get-session`).
- Web: HTTP-only session cookie (`better-auth.session_token`, `SameSite=Lax`, `Secure` in prod), `credentials: 'include'`.
- Android: `Authorization: Bearer <session token>` (better-auth bearer plugin) on the same endpoints.
- Every request resolves the caller's `company_id`, user id and role set; tenancy is never taken from client input.

## Errors

Every non-2xx response has the shape:

```json
{ "error": { "code": "FORBIDDEN", "message": "Human readable", "details": {}, "requestId": "..." } }
```

| HTTP | code                                        | when                                                                               |
| ---- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| 400  | `BAD_REQUEST`                               | malformed request                                                                  |
| 401  | `UNAUTHENTICATED`                           | no/expired session                                                                 |
| 403  | `FORBIDDEN`                                 | role, hierarchy or tenant denies it                                                |
| 404  | `NOT_FOUND`                                 | missing **or not visible to caller** (no existence leaks across tenants/hierarchy) |
| 409  | `VERSION_CONFLICT` / `IDEMPOTENCY_CONFLICT` | stale `version`, or same key with a different body                                 |
| 422  | `VALIDATION`                                | zod validation failed; `details` = `z.treeifyError` output                         |
| 429  | `RATE_LIMITED`                              |                                                                                    |
| 5xx  | `INTERNAL`                                  |                                                                                    |

## Pagination

- Cursor based: `?limit=50&cursor=<opaque>`; response `{ items, nextCursor, serverTime }`. `limit` max 200. `nextCursor: null` means last page.
- Order is stable: `(updated_at, id)` ascending for sync, otherwise resource-specific.

## Offline sync (Android)

- Every tenant row has `id` (UUIDv7, client may generate), `createdAt`, `updatedAt`, `deletedAt` (tombstone), `version`.
- Delta pull: `GET /v1/<resource>?updatedSince=<serverTime from last pull>` returns changed rows **including tombstones** (`deletedAt != null`). Store `serverTime` from the response as the next watermark (never the device clock).
- Writes: `PATCH` must send the `version` it read; mismatch -> `409 VERSION_CONFLICT` with the current row in `details`.
- Deletes are soft (`DELETE` sets `deletedAt`).

## Idempotency

- `POST` accepts `Idempotency-Key` (<=128 chars, UUID recommended). Same key + same body within 24h returns the original response; same key + different body -> 409. Required for offline-queued writes from Android.

## Naming

- JSON fields camelCase; DB columns snake_case. Ids are UUID strings. Timestamps ISO-8601 UTC. Money as integer paise. Geo as `{ lat, lng }` (WGS84).

## Typed client and mocks (for apps/web)

```ts
import { createApiClient } from '@ariforce/contracts';
const api = createApiClient(process.env.NEXT_PUBLIC_API_URL!);
const { data, error } = await api.GET('/v1/doctors', { params: { query: { limit: 20 } } });
```

Mock mode (no API needed): `@ariforce/contracts/mocks` exports `createHandlers(baseUrl)` (MSW v2). In the browser:
`pnpm -F @ariforce/web exec msw init public` once, then `setupWorker(...createHandlers(apiUrl)).start()` when
`NEXT_PUBLIC_API_MOCKING=enabled`. Responses are parsed through the zod schemas, so mocks match the contract.

## Files

Uploads/downloads use presigned R2 URLs. See [STORAGE.md](STORAGE.md).

## Devices and consent

`/v1/devices` (enrol company or personal phone) and `/v1/devices/{id}/consents` (append-only DPDP ledger) are contract-first. The implementation lands with the mobile app. GPS is sent only as point captures (`GeoCapture`) on punch-in, visit, punch-out and geo-tag, never as a continuous trail.

## Lists: search, sort, filters, totals

Every list takes `limit` (≤200), `cursor`, `updatedSince`, `q`, `sort` (`field` / `-field`, allow-list per
endpoint, unknown → 422) and `includeTotal=true` (adds `total`; ignored with `updatedSince`). Resource
filters (`territoryId` includes descendants, `specialtyId`, `categoryId`, `from`/`to`, `userId`, `status`)
are listed per operation in openapi.json. Territories page with the cursor past 200; `code=` gives an exact
lookup for imports. Specialties and doctor categories are read-only in v1. The MSW mocks honour all of these.

## Roles

Sales hierarchy (rank 1→8): business_manager, area_business_manager, regional_business_manager,
zonal_business_manager, sales_manager, general_manager, vice_president, director. Each user sees their own
reporting-line subtree (`manager_id`); director sees the company. `system_admin` (rank 0) is outside the
hierarchy: users, masters, imports and settings, but no field data unless granted. Territory levels
(national/zone/region/area/headquarter) are independent of role names.

## Imports

`POST /v1/{doctors|chemists|stockists|products}/import` with `dryRun` (default true), `onDuplicate`
(skip/update/error) and ≤5,000 rows. Returns an `ImportJob` with per-row `{row, status, errors, id,
duplicateOf, duplicateRule}`. Duplicate rules (#26): doctors by registrationNo then name+pincode; chemists
and stockists by GSTIN, drug licence, then name+pincode; products by code; repeats inside the file are
`in_file` errors. See docs/IMPORT.md.

## Field: check-ins, attendance, tour plan, DCR, approvals

GPS only at `punch_in`, `visit` and `punch_out` (`POST /v1/check-ins`, idempotent on `clientId`); 409 on
sequence errors, 412 without DPDP consent (`GET /v1/me/consent`), geofence from `/v1/settings/geofence`.
`GET /v1/attendance` is one row per user-day. Tour plans are per month (`PUT`, `/copy` for STP→MTP,
`/submit` creates an approval). `PUT /v1/dcrs` upserts the day's DCR; each call carries products detailed
(ordered), samples (qty) and POB lines. `POST /v1/approvals/{id}/decision` (reject needs a comment).

## Mock sign-in and personas

The MSW mock mirrors better-auth: `POST /v1/auth/sign-in/email` accepts any password for
`<persona>@demo.ariforce.in` (director, vp, gm, sm, zbm, rbm, abm, bm, sysadmin), returns
`set-auth-token: mock:<role_key>` and a `better-auth.session_token` cookie. Requests are resolved as:
`x-mock-user` header (role key, email or local part; `none` = signed out) > bearer/cookie token >
default persona (director). The real API ignores `x-mock-user`.

## Sign-up and account-state codes

| Code                       | Status | Where                                                                                                                        |
| -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `ACCOUNT_PENDING_APPROVAL` | 403    | sign-in (`{code,message}`), any data endpoint (`{error:{code,message}}`)                                                     |
| `ACCOUNT_REJECTED`         | 403    | same as above                                                                                                                |
| `SIGNUP_UNAVAILABLE`       | 409    | `POST /v1/auth/sign-up-request`. Deliberately generic so emails can't be enumerated.                                         |
| `RATE_LIMITED`             | 429    | sign-up request; limits are per IP (`SIGNUP_RATE_PER_IP`, default 10/h) and per email (`SIGNUP_RATE_PER_EMAIL`, default 3/h) |
| `CAPTCHA_FAILED`           | 403    | sign-up request; only when `TURNSTILE_SECRET` is set (send `turnstileToken`)                                                 |
| `SIGNUP_DISABLED`          | 503    | the sign-up company slug is not configured                                                                                   |

See docs/SIGNUP.md for the screen states.
