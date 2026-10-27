# Contract changelog

API contract changes per feature, newest first. Scope: commits reachable from
`feat/26-doctor-approval` (`e578119`). Endpoint and schema lists were derived by diffing
`docs/api/openapi.json` between consecutive commits; error codes by grepping `apps/api/src` and
`packages/contracts/src` at each commit. Prose notes come from the feature docs and commit
messages. Anything not checked that way is marked **unverified**.

"Additive" = existing clients keep working. "Breaking" = a client built on the previous contract
can fail or misbehave (removed fields, new required request fields, changed status codes, widened
response enums, or changed server behaviour for the same request).

## Breaking changes

| Feature (commit)                    | Change                                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Doctor approval #26 (`e578119`)     | `POST /v1/doctors` can now return `409 DOCTOR_DUPLICATE` / `DOCTOR_POSSIBLE_DUPLICATE`; doctors created by non-company-wide users start `pending`; DCR refuses rejected doctors (`422 VALIDATION`, `details.doctorIds`) |
| TA/DA #39 (`6d66770`)               | `ExpenseCategory` gains `allowance` (response enum widened); `ExpenseLine` gains required `source` and `allowancePlaceId`                                                                                               |
| POB/RCPA #40 (`72c770a`, `48a135c`) | POB line `value` is computed by the server (`quantity × PTR`, else `null`); a client-sent `value` is ignored. Before, it was stored as sent                                                                             |
| Invite gaps (`a575db1`)             | `POST /v1/invites/accept`: password minimum 8 → 12; used/expired tokens now `409 INVITE_USED` / `410 INVITE_EXPIRED` instead of `404 INVITE_INVALID`                                                                    |
| Security #81 (`2789b64`)            | `/docs` and `/openapi.json` are not served when `NODE_ENV=production`                                                                                                                                                   |
| Security #79 (`4dea14b`)            | Deactivation or role change revokes all sessions; suspended users get `ACCOUNT_SUSPENDED` on sign-in                                                                                                                    |
| Security #77 (`16e1116`)            | Auth, sign-up and invite-accept routes can return `429 RATE_LIMITED` with `Retry-After`                                                                                                                                 |
| Health (`a72e145`)                  | `HealthWarning` dropped `companyId` / `companySlug` and became aggregate (`NO_WORK_TYPES` with `count`). Only clients of `0c97952` are affected                                                                         |
| TP submit (`36c29f5`)               | `POST /v1/tour-plans/{month}/submit` 422 rule changed: weekly offs and past days of the current month (IST) are no longer required                                                                                      |

## Doctor approval #26

- Branch `feat/26-doctor-approval`, commits `e578119` (code) and `d53c1c6` (docs). Migration `0035`
  (indexes only). Doc: `DOCTOR-APPROVAL.md`.
- Added `POST /v1/doctors/duplicate-check` → `DoctorDuplicateResult { matches: DoctorDuplicate[] }`.
- Changed `GET /v1/doctors`: optional `approvalStatus` query filter. `Doctor.approvalStatus`
  (`pending | approved | rejected`) is now in every doctor response.
- Changed `POST /v1/doctors`: optional `allowPossibleDuplicate`; new `409 DOCTOR_DUPLICATE`
  (registration number, cannot be overridden) and `409 DOCTOR_POSSIBLE_DUPLICATE` (name + pincode;
  re-send with `allowPossibleDuplicate: true`), both with `details.matches`.
- Changed `PATCH /v1/doctors/{id}`: editing a rejected doctor sends it back to `pending`
  (behaviour; **unverified** against OpenAPI, which has no change for this route).
- Breaking (behaviour and new 409s). Open question: BM/ABM cannot add doctors (no `masters:write`).

## CORS exposed headers

- Branch `feat/39-tada-allowances` (tip), commit `5d2762d`. No migration.
- CORS for `WEB_ORIGIN` origins now exposes `Retry-After` and `Content-Disposition`
  (`apps/api/src/bootstrap.ts`). Additive. Not in OpenAPI (CORS is not described there).

## TA/DA allowances #39

- Branch `feat/39-tada-allowances`, commit `6d66770`. Migration `0034`. Doc: `TADA.md`.
- Added `GET/POST /v1/allowance-rates`, `PUT/DELETE /v1/allowance-rates/{id}`,
  `GET/POST /v1/allowance-places`, `PUT/DELETE /v1/allowance-places/{id}`,
  `POST /v1/expense-claims/{id}/allowances` (drafts TA/DA lines from DCRs).
- Changed schemas: `ExpenseCategory` + `allowance`; `ExpenseLine` + `source`, `allowancePlaceId`
  (both required in responses).
- Error codes: `DUPLICATE_RATE`, `DUPLICATE_PLACE`, `NOT_HQ_TERRITORY`, `PLACE_NOT_USABLE`.
- Breaking for clients that switch exhaustively on `ExpenseCategory`; otherwise additive.

## Product prices admin

- Branch `feat/product-prices-admin`, commits `acafccf` and `48a135c`. Migrations `0032`, `0033`.
  Doc: `PRODUCTS.md`.
- Added `GET /v1/admin/products`, `PATCH /v1/admin/products/{id}/prices`,
  `POST /v1/admin/products/prices/bulk`, `GET /v1/admin/products/{id}/price-history`. Permission
  `products:prices` (System Admin).
- Error codes: `PRODUCT_NOT_FOUND`, `PTR_ABOVE_MRP` (plus `VERSION_CONFLICT`).
- `acafccf` added `PRICES_ADMIN_ONLY` on the generic product routes; `48a135c` removed it, so the
  generic product routes are unchanged from before this feature. Also in `48a135c`: re-saving a DCR
  keeps a POB line's stored value while call, product and quantity are unchanged.
- Additive.

## Exceptions #56

- Branch `feat/56-exceptions`, commits `58433c3` (data model) and `5fdd41f` (API). Migration `0031`.
  Doc: `EXCEPTIONS.md`.
- Added `GET /v1/exceptions`, `GET /v1/exceptions/summary`, `GET/PATCH /v1/exceptions/{id}`,
  `POST /v1/exceptions/{id}/explain|resolve|dismiss`, `POST /v1/exceptions/evaluate`,
  `GET /v1/exception-rules`, `PUT /v1/exception-rules/{code}`.
- `NotificationType` gains exception values; `TeamProfile` gains optional `exceptions`.
- Error codes: `EXCEPTION_CLOSED`, `ASSIGNEE_OUT_OF_SCOPE`, `THRESHOLD_OUT_OF_RANGE`.
- Additive (new enum values on `NotificationType` are a widening; see breaking table rules).

## Jobs hardening

- Branch `fix/jobs-functions-hardening`, commit `0d5039e`. Migration `0030`.
- Hardens the `SECURITY DEFINER` `jobs_*` functions (runner-only). No API change.

## POB/RCPA #40

- Branch `feat/40-pob-rcpa`, commits `6a9cc91` (table), `72c770a` (API), `de138d4` (POB on doctor
  calls), merged into the main line at `750e26d`. Migration `0029`. Doc: `POB-RCPA.md`.
- Added `GET /v1/rcpa/competitor-brands`.
- Changed `PUT /v1/dcrs`: `DcrCallInput.rcpa` (optional); `DcrCall.rcpa` always returned. POB lines
  are allowed on doctor calls too (`de138d4`); RCPA stays chemist-only.
- POB `value` is server-computed (`quantity × products.ptr`, else `null`); client value ignored.
- Breaking (behaviour of `value`); the rest is additive. RCPA rejection codes: **unverified** (the
  grep found no new named codes; validation appears to use `422 VALIDATION`).

## Notifications #35

- Branch `feat/35-notifications`, commit `4fa4151`. Migration `0028`. Doc: `NOTIFICATIONS.md`.
- Added `GET /v1/notifications`, `GET /v1/notifications/unread-count`,
  `POST /v1/notifications/{id}/read`, `POST /v1/notifications/read-all`, `GET /v1/jobs/stats`.
- Leave and expense events create in-app notifications through the DB job runner. Additive.

## Invite gaps

- Branch `feat/26-invite-gaps`, commit `a575db1`. Migration `0027`.
- Added `POST /v1/employees/invite-bulk` (per-row results; `DUPLICATE_IN_BATCH` per row).
- Changed `POST /v1/invites/accept`: password min 12; `404 INVITE_INVALID`, `409 INVITE_USED`,
  `410 INVITE_EXPIRED`, `422 VALIDATION`, `429 RATE_LIMITED`.
- Breaking (min length and status codes).

## Security batch #79, #80, #77, #81

- Branches `sec/79-session-revocation` (`4dea14b`), `sec/80-env-validation` (`d217a30`),
  `sec/77-client-ip-ratelimit` (`16e1116`), `sec/81-helmet-docs` (`2789b64`). No migrations.
  Doc: `SECURITY.md`.
- #79: sessions revoked on deactivation or role change; suspended users cannot sign in
  (`ACCOUNT_SUSPENDED`, listed in `AUTH_STATE_CODES`).
- #80: production env validation at boot (names only). No HTTP contract change.
- #77: client IP from `CF-Connecting-IP` only in `CLIENT_IP_MODE=cloudflare`, never
  `X-Forwarded-For`; `429 RATE_LIMITED` with `Retry-After`.
- #81: Helmet headers, HSTS in production, `/docs` and `/openapi.json` hidden in production.
- No path or schema change in OpenAPI for #79/#80/#81; the 429 responses appear in OpenAPI from
  `a575db1`. Breaking as listed above.

## Tour plan submit rule and calendar

- Branch `fix/tp-submit-past-days`, commit `36c29f5`. No migration. Doc: `TOUR-PLANS.md`.
- Added `GET /v1/tour-plans/{month}/calendar` (`TourPlanCalendar`).
- Changed `POST /v1/tour-plans/{month}/submit`: `422` with `details { missingDates, todayIST,
weeklyOffDays }`; required dates are non-weekly-off dates, and in the current month (IST) only
  today and later.
- **`EMPTY_PLAN` is not on this line.** The "one planned day is enough; `422 EMPTY_PLAN` for an
  empty plan" rule is commit `0bb7b40` on `fix/tp-submit-any-day`, merged only into
  `feat/20-real-api` (and the web there expects it). On `e578119` the API still uses the
  missing-dates rule above.

## Work types seed and health warnings

- Branch `fix/work-types-seed`, commits `0c97952` and `a72e145`. Migration `0026`.
- `GET /v1/health` now returns `Health { status: 'ok', warnings: HealthWarning[] }`.
  `HealthWarning` is `NO_WORK_TYPES { code, count, message }` or
  `WORK_TYPES_CHECK_FAILED { code, message }`; aggregate only since `a72e145`.
- Additive relative to before `0c97952`.

## Team profile #75

- Branch `feat/75-team-profile`, commits `7f5caa5` (contracts) and `8e6b0f9` (API). No migration.
  Doc: `TEAM-PROFILE.md`.
- Added `GET /v1/team/members/{userId}/profile|performance|doctors|chemists|export`.
- Error code: `RANGE_TOO_LONG`. Additive.

## Leave #51, including 14-day backdating

- Branch `feat/51-leave`, commits `59fa8ba`, `2c2090a`, `93b5b70`. Migrations `0023`–`0025`. Doc:
  `LEAVE.md`.
- Added `GET /v1/leave/types`, `PUT /v1/leave/types/{code}`, `GET/PUT /v1/leave/settings`,
  `GET/POST /v1/leave/requests`, `GET /v1/leave/requests/{id}`,
  `POST /v1/leave/requests/{id}/cancel|decision`, `GET /v1/leave/balances`,
  `GET/POST /v1/leave/grants`, `POST /v1/leave/carry-forward`, `GET /v1/leave/calendar`.
- Error codes: `LEAVE_OVERLAP`, `LEAVE_NO_WORKING_DAYS`, `LEAVE_HALF_DAY_NOT_ALLOWED`,
  `LEAVE_NOT_CANCELLABLE`, `LEAVE_SELF_GRANT`, `LEAVE_SPANS_YEARS`, `LEAVE_TOO_FAR_AHEAD`,
  `LEAVE_TYPE_UNKNOWN`, `LEAVE_DAY_BLOCKED`.
- `93b5b70`: backdating window default 14 days (`LEAVE_DEFAULT_BACKDATE_DAYS`) for new companies.
  The SQL column default from `0023` is still 7; the API sets 14 when it creates settings. Additive.

## Expense claims #52

- Branch `feat/signup-requests` (tip `ddcb66e`), commits `f526c08`, `ddcb66e`, `0fd263f`.
  Migrations `0021`, `0022`. Doc: `EXPENSES.md`.
- Added `GET/POST /v1/expense-claims`, `GET /v1/expense-claims/{id}`,
  `POST /v1/expense-claims/{id}/lines`, `PUT/DELETE /v1/expense-claims/{id}/lines/{lineId}`,
  `POST /v1/expense-claims/{id}/lines/{lineId}/attachments`,
  `POST /v1/expense-attachments/{id}/confirm|download-url`, `DELETE /v1/expense-attachments/{id}`,
  `POST /v1/expense-claims/{id}/submit|decision|pay`, `GET /v1/expense-claims/{id}/reconciliation`,
  `GET /v1/expense-reports`, `GET /v1/expense-reports/export`.
- Error codes: `EXPENSE_EMPTY`, `EXPENSE_NOT_EDITABLE`, `RECEIPT_REQUIRED`, `TOO_MANY_FILES`,
  `UPLOAD_MISSING`, `UPLOAD_NOT_CONFIRMED`, `APPROVAL_NOT_YOUR_STEP`,
  `APPROVAL_ALREADY_DECIDED_BY_YOU`. Additive.

## Sign-up requests

- Branch `feat/signup-requests`, commits `c067e17` and `787e450`. Migration `0020`. Doc:
  `SIGNUP.md`.
- Added `POST /v1/auth/sign-up-request`, `GET /v1/signup-requests`,
  `POST /v1/signup-requests/{id}/approve|reject`, `GET /v1/auth/sign-up-options` (`787e450`).
- Error codes: `SIGNUP_DISABLED`, and the sign-in states `ACCOUNT_PENDING_APPROVAL`,
  `ACCOUNT_REJECTED`, `SIGNUP_UNAVAILABLE`, `CAPTCHA_FAILED`. Additive.

## Director account

- Commit `7d605f2`, on the `feat/signup-requests` lineage (no own branch found). No migration.
- System admins can create or invite directors (no manager); `admin:create-first --role`.
  No OpenAPI change detected. Additive.

## Role-permissions seed

- Commit `49bd156`, on the `feat/signup-requests` lineage. Migration `0019` (generated from
  `DEFAULT_ROLE_PERMISSIONS`; `db:role-perms:check`). No API contract change.

## Not verified / inconsistencies

- `EMPTY_PLAN` is missing from this line (see Tour plans).
- `PATCH /v1/doctors/{id}` re-pending and the RCPA error details are from the feature docs only.
- `GET /v1/users` (`c067e17`) and `GET /v1/approvals` (`ddcb66e`) changed in OpenAPI only in their
  operation text; no parameter or response change was found.
- Leave backdating: SQL default 7 vs API default 14.
