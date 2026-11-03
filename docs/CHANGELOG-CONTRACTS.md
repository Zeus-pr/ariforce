# Contract changelog

API contract changes per feature, newest first. Scope: commits reachable from
`feat/26-doctor-approval` (`e578119`) plus `fix/tp-submit-any-day` (`0bb7b40`), merged at `74ab9a9`. Endpoint and schema lists were derived by diffing
`docs/api/openapi.json` between consecutive commits; error codes by grepping `apps/api/src` and
`packages/contracts/src` at each commit. Prose notes come from the feature docs and commit
messages. Anything not checked that way is marked **unverified**.

"Additive" = existing clients keep working. "Breaking" = a client built on the previous contract
can fail or misbehave (removed fields, new required request fields, changed status codes, widened
response enums, or changed server behaviour for the same request).

## feat/dcr-expenses (server, no contract change)

- Implements DCR expenses as specified: draft/submit persistence, idempotent link into the month
  claim (origin `dcr`), `claim_locked` skip, `DCR_EXPENSE_CATEGORY_INVALID`, read fields on Dcr.
- `ExpenseLine.origin` is now returned (`manual` | `ta_da` | `dcr`). Editing/deleting an origin
  `dcr` line returns 409 `EXPENSE_NOT_EDITABLE` (`details.reason: 'DCR_LINE'`).

## feat/dcr-meeting-times (2026-11-04): server for meeting sub-types, endTime, places

No contract change, no migration. Enforces #121 on PUT /v1/dcrs/draft, POST /v1/dcrs/{id}/submit,
PUT /v1/tour-plans/items and POST /v1/tour-plans/items/{id}/submit: MEETING_TYPE_INVALID,
END_TIME_NOT_AFTER_START, DURATION_TOO_LONG (422); durationMin derived from startTime/endTime.
Behaviour change for the same request: a meeting with a title other than the two labels, sent by
an older client, is now 422. Data fix (not run):
`packages/db/scripts/data-fixes/2026-11-04-meeting-title-normalise.sql`.

## feat/dcr-tp-contract (2026-11-03): meeting sub-types, DCR expenses, end time and places

Contract only (phase 1); server lands in phase 2. Additive: every new field is optional on input
and in responses, so current clients and the current API keep working.

- Meeting sub-type stays in `details.title` (DCR `details` and TP `plan.details`): on write it
  must be "Cycle Meeting" or "Review Meeting" (`MEETING_TYPES`), else 422
  `MEETING_TYPE_INVALID` (details.allowed). Legacy rows keep other free text and read unchanged.
- `endTime` (HH:mm IST, nullable) on meeting, training and office (Admin Work) details;
  `durationMin` (existing name) is derived from startTime/endTime and is now optional on input
  (deprecated; ignored when endTime is sent). endTime <= startTime, or endTime without a start
  time -> 422 `END_TIME_NOT_AFTER_START`; end - start > 720 min -> 422 `DURATION_TOO_LONG`
  (same limit as the existing durationMin max). Admin work: startTime required with endTime.
  Field work: unchanged.
- `fromPlace` / `toPlace` (free text, max 120, optional) on meeting and office details only.
  Training: endTime only.
- `DcrExpenseItem` {category (travel|hotel|food|other), amount, note?}; `Dcr.expenses` (optional, max 20) and `DcrDraftPut.expenses` (omit = keep).
  allowance/mileage -> 422 `DCR_EXPENSE_CATEGORY_INVALID` (details.index, details.allowed).
- `DcrSubmit.expenses` (optional; replaces the saved list before submit) and submit response
  `expenseClaimId`, `expenseTotal`, `expenseCount` (optional). Clients never create claim lines.
- `Dcr` read shapes (detail, list items, submit response) gain `expenseClaimId` (uuid|null),
  `expenseTotal`, `expenseCount` (optional; from the claim's live origin-dcr lines of that DCR;
  null/0/0 when none), so a reopened report can show "Added to expenses" with a claim link.
- `durationMin` may still be sent next to `endTime`; it is ignored and derived.
- Category mapping: DCR categories are a subset of the existing `ExpenseCategory` enum, mapped
  1:1 by value (travel, hotel, food, other); no mapping table.
- Training details have no places; extra keys (fromPlace/toPlace) are stripped (accepted and
  ignored), as zod does for any unknown key.
- `ExpenseLine.origin` (`manual` | `ta_da` | `dcr`, optional);
  `origin: dcr` = show "from DCR", `dcrId` = that DCR. `source` enum unchanged (dcr lines are
  `auto`, never touched by a TA/DA re-run).
- `DcrSubmitResult.dcrExpenses` (`DcrExpenseLink`: status linked|skipped|error, reason
  claim_locked|no_expenses, claimId, claimStatus, claimCreated, lines, total). Month claim
  submitted/approved/paid -> skipped/claim_locked, the submit still succeeds.
- Error codes documented on PUT /v1/dcrs/draft, POST /v1/dcrs/{id}/submit and PUT
  /v1/tour-plans/items. Helpers: `MEETING_TYPES`, `isMeetingType`, `deriveDurationMinutes`.

## perf/territories-compact (2026-11-03): compact territory list

Additive, no migration. New GET /v1/territories/compact (permission: same as GET /v1/territories).
Query: level?, parentId?, ancestorId?, limit? (1..2000, default 2000), cursor?. Response
TerritoryCompactList {items: {id, name, level, parentId}[], nextCursor}. Same company and caller
subtree scope as the full list, non-deleted only, name order. Weak ETag + Cache-Control: private,
max-age=60; If-None-Match -> 304.

## perf/batch-ids-doctor360 (2026-11-03): Doctor 360 filters on DCR and check-in lists

Additive, no migration.

- GET /v1/dcrs: new optional `doctorId` (uuid). Only DCRs with at least one non-deleted call at
  that doctor. User scope unchanged (own DCRs; reporting line for dcr:review); `limit`/`cursor` as
  before.
- GET /v1/check-ins: new optional `doctorId` (uuid), same as `outletKind=doctor&outletId=`.
  `userId` outside the reporting line is still 403.
- `ids=` batch fetch on /v1/chemists and /v1/stockists already existed (max 100, readable rows
  only, 422 on bad ids); now covered by a test.

## perf/expense-list-paging-report-batch (2026-11-03): opt-in paging for expense claims (additive)

- `GET /v1/expense-claims`: new optional `limit` (1..200) and `cursor` (opaque, from `nextCursor`).
  Without both: unchanged (all matching claims, body `{ items }` only).
  With either: one page (limit defaults to 50), ordered month desc, user name, id; body adds `limit`, `total` (all pages) and `nextCursor` (null on the last page). Bad cursor or limit: 422 `VALIDATION`.
- `GET /v1/expense-reports` and exports: same output; the server now loads lines and DCR days for all claims in two queries instead of three per claim.

## perf/dcr-products-endpoint (2026-11-03): DCR products on their own endpoint (additive)

- New: `GET /v1/dcrs/products` (`field:read`) -> `DcrProducts { products: DcrProductOption[], detailProducts: DcrDetailProduct[], etag }`.
  Same items as `options.products` / `options.detailProducts`. Optional `ids=` (1..100 comma-separated UUIDs, only active products returned).
  Headers: `ETag` (weak, also in the body), `Cache-Control: private, max-age=60`. `If-None-Match` with the etag -> `304`, empty body.
  The etag changes when any product row changes or the 30-min image-URL signing window rolls, so a 304 never keeps expired picture URLs.
- `GET /v1/dcrs/options`: new optional `includeProducts=false` returns `products: []`, `detailProducts: []` (skips the product load). Default unchanged.
  `products` / `detailProducts` are marked **deprecated** (still filled by default).
- No `updatedSince`: removals (deactivated/deleted products) would need tombstones; revalidate with the ETag instead.

## feat/dcr-pob-review (2026-10-29): expense approval needs approved DCRs; unlock decisions director-only

Migration 0051 (roles.permissions: dcr_unlock:decide for director).

- Behaviour (breaking for approvers): approving an expense claim (any step; POST
  /v1/approvals/{id}/decision and POST /v1/expenses/{id}/decision) needs an APPROVED DCR of the
  owner on every line date, else 409 DCR_NOT_APPROVED, details {dates[], dcrIds[], dcrStatus{date:
  draft|submitted|rejected|missing}}. Rejecting is unaffected.
- New permission `dcr_unlock:decide` (director only). DCR unlock/correction requests
  (subjectType dcr_unlock) need it: 403 APPROVAL_PERMISSION_REQUIRED {permission}. They are left out
  of `mine=to_decide` for everyone else. Other approval types keep approvals:decide; dcr:review is
  unchanged (ABM and up).
- Additive: `Approval.canDecide` (list and get): whether the caller can decide it now.

## feat/dcr-pob-review (2026-10-29): tour plan items (one day or from-to) as DCR draft cards

Migration 0050 (additive: table tour_plan_items, dcrs.tour_plan_item_id).

- Additive: `TourPlanItem` {id, companyId, userId, userName, from, to (<= 31 days), status
  draft|pending|approved|rejected, rejectionReason, plan {workTypeId, territoryIds,
  workWithUserIds, sfcRoutes[{hqTerritoryId, sfcRouteId}], details|null}, filedDates, version,
  createdAt, updatedAt, submittedAt, decidedAt, decidedBy}.
- New endpoints: GET /v1/tour-plans/items (?mine=true own, newest first; else team, never own,
  approvals:decide or field:read; ?status), GET/DELETE /v1/tour-plans/items/{id}, PUT
  /v1/tour-plans/items (create or edit draft/rejected -> draft), POST .../{id}/submit (-> pending,
  one approval request routed like the monthly TP), POST .../{id}/decision {decision, comment}
  (approvals:decide, reporting line, never your own; comment required to reject).
  Errors: TP_LOCKED, TP_OVERLAP, TP_IN_PAST, VERSION_CONFLICT, REJECTION_REASON_REQUIRED.
- Additive: `DcrOptions.tourPlanDrafts[]` = approved items + {pendingDates, draftDates,
  fileableDates}. Listed while an unfiled day is today (IST) or later.
- Additive: `DcrDraftPut.tourPlanItemId`; `Dcr.tourPlanItemId`. The date must lie in an approved
  item of yours (422 VALIDATION, details.reason TOUR_PLAN_ITEM_MISMATCH). With it, a future date
  may be drafted; submit still needs the day. Without it, the covering approved item is linked.
- Behaviour (relaxing): 422 DEVIATION_REASON_REQUIRED is no longer raised (DCR flow submit and legacy
  PUT /v1/dcrs).
- GET /v1/approvals omits tour plan item requests (they have their own queue).
- Monthly TourPlan unchanged (TourPlanEntry is back to its c44b325 shape).

## feat/dcr-pob-review (2026-10-29): product displayName, doctor detailing picker

- Additive: `Product.displayName` and `AdminProduct.displayName` (readOnly, derived from `name`
  without strength numbers: 'ARIPIX 10' -> 'ARIPIX', 'ESCINEX CZ 10/0.25' -> 'ESCINEX CZ'). Helper
  `productDisplayName()` exported from @ariforce/contracts. `DcrProductOption.displayName`.
- Additive: `DcrOptions.detailProducts[]` `{displayName, productId, productIds[], composition,
imageFileKey, imageUrl}`: one entry per displayName (A-Z); `productId` = first SKU with a
  picture, else the first. Store `productId` in `productsDetailed`.
- GET /v1/doctors|chemists|stockists|products default and sort=name order: lower(name), id.

## feat/dcr-pob-review (2026-10-29): POB at PTS, doctor presentation, manager review, IST lock

Needs migrations 0048 + 0049 (not applied yet).

- **Breaking**: `PobLine.value` is now priced at `products.pts` (was PTR). POB on a doctor call is
  rejected: 422 `VALIDATION`, `details.reason = POB_NOT_ALLOWED_FOR_DOCTOR`, `details.callIndexes/callIds`.
- **Breaking**: on submit, every doctor call with non-empty `productsDetailed` needs
  `DcrCall.presentationOpenedAt` (ISO, nullable; accepted by PUT /v1/dcrs/draft and PUT /v1/dcrs).
  Otherwise 422 `VALIDATION`, `details.reason = PRESENTATION_NOT_OPENED`, `details.callIndexes/callIds`.
- **Breaking**: `DcrCall.calledAt` is readOnly: set by the server when the call (clientId) is first
  saved, kept on re-save; client values are ignored.
- **Breaking**: day lock is 00:00 Asia/Kolkata on the day after the DCR date (was company tz + 24 h).
  `companies.dcr_lock_after_hours` no longer applies to DCRs (also the missed-DCR exception deadline).
- **Breaking (widened enum)**: `Dcr.status` adds `approved`, `rejected`. New `Dcr.reviewStatus`
  (pending|approved|rejected|null), `approvedAt`, `approvedBy`, `rejectedAt`, `rejectedBy`, `rejectionReason`.
- **Breaking**: GET /v1/dcrs: team scope only for callers with `dcr:review` (and not `mine=true`);
  everyone else sees only their own DCRs. `status` filter accepts draft|submitted|locked|approved|rejected.
- New POST /v1/dcrs/{id}/decision `{decision: approve|reject, comment?}` (comment 1-500 required to
  reject, stored as `rejectionReason`). 403 own DCR, 404 outside team, 409 `NOT_PENDING_REVIEW`.
- New permission `dcr:review` (ABM..director, system_admin).
- Rejected reports count nowhere (no `DAY_ALREADY_SUBMITTED`, not `options.submitted`), are listed in
  `options.rejected`, and reopen the day for 48 h for the rep.
- `DcrOptions` adds `rejected[]`, `unlockRequest {id,status,requestedAt}|null`, `products[]`
  (id, divisionId, code, name, brand, composition, packSize, form, mrp, pts, isSample, imageFileKey, imageUrl).

## Breaking changes

| Feature (commit)                                               | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DCR multi-draft (`feat/dcr-multi-draft`, migration 0045)       | **Behaviour change for web.** `PUT /v1/dcrs/draft` without `id` and without `version` now creates a new draft every time (was: upsert per user + date). Without `id` but with `version` it still updates the latest draft of the date (older clients). Draft saves and submits on a date that already has a submitted report return `409 DAY_ALREADY_SUBMITTED` (`details.existingId`) instead of `409 ALREADY_SUBMITTED`. Send `id` to update a specific draft                                                                                                                                                                                                                                                 |
| Territory levels + approvals (`feat/sfc-routes`, Part 3)       | **Breaking for web.** Assigning a `business_manager` any non-`headquarter` territory now returns `422 TERRITORY_LEVEL_INVALID` (`details.territoryIds`, `details.expectedLevel`, `details.role`) on create, invite-bulk (row code), PATCH role/territories, signup approve. Approvals can now finish before the configured level count when the decider already covers the next approver.                                                                                                                                                                                                                                                                                                                       |
| Retired roles + expense pay (`feat/sfc-routes`, Part 2)        | **Breaking for web; reverses part of "System admin invites any role".** `distribution_head` / `accountant` can no longer be assigned: create, invite-bulk (row code), PATCH role, sign-up approve and sign-up submit return `422 ROLE_RETIRED`. `GET /v1/roles` omits them. Holders get `403 ROLE_RETIRED` on sign-in, `422 ROLE_RETIRED` on invite accept and on re-invite. `AUTH_STATE_CODES.retired` added. Mark-paid permission renamed: `POST /v1/expense-claims/{id}/pay` needs `expenses:pay` (director, system_admin) instead of `finance:write`; company-wide approved/paid claim reads and `/expense-reports` use `expenses:pay` instead of `finance:read`. Gate UI on `expenses:pay`. Migration 0040 |
| TP per-day submissions #86 (`feat/86-tp-submissions`)          | **Breaking for web.** Tour-plan `Approval.subjectId` is now a submission id (plan id in `payload.planId` / detail `subject.plan.id`). `PUT /v1/tour-plans/{month}` returns `409 DAY_LOCKED` (`details.dates`) when a submitted/approved day changes, instead of `409` for any non-draft plan; copy keeps locked days. `POST .../submit` no longer returns `409 Not in draft`: it submits the remaining draft/rejected days, or `409 DAY_LOCKED` / `422 EMPTY_PLAN`. Editing a rejected plan keeps month status `rejected` (was `draft`). Month status is now an aggregate. DCR plan, attendance, `tp_not_submitted` and `kpi_tp_adherence_month` use approved days only                                         |
| Approvals detail + rejection reasons (`feat/approvals-detail`) | **Breaking for web.** Rejecting without a non-blank reason now returns `422 REJECTION_REASON_REQUIRED` (was `422 VALIDATION` for missing/empty on approvals, leave and expense; whitespace-only used to pass; sign-up reject allowed no reason at all). `NotificationType` gains `tour_plan.rejected`, `doctor.rejected`, `dcr_unlock.rejected` and `Notification.entityType` gains `tour_plan`, `doctor`, `approval_request` (widened response enums). Rejection notification bodies say `Reason:` instead of `Comment:`. `NotificationType` also gains `tour_plan.approved`, `doctor.approved`. Tour plan submit now clears `decisionComment`/`decidedBy`/`decidedAt`, and editing a rejected plan keeps them |
| TP submit `EMPTY_PLAN` (`0bb7b40`, merged `74ab9a9`)           | **Breaking for web.** `POST /v1/tour-plans/{month}/submit` no longer returns `422` with `details { missingDates, todayIST, weeklyOffDays }`. One planned day is enough; an empty plan returns `422 EMPTY_PLAN`. Past days stay editable; `requiredDates` on the calendar is informational only. Now on this line                                                                                                                                                                                                                                                                                                                                                                                                |
| Doctor approval #26 (`e578119`)                                | `POST /v1/doctors` can now return `409 DOCTOR_DUPLICATE` / `DOCTOR_POSSIBLE_DUPLICATE`; doctors created by non-company-wide users start `pending`; DCR refuses rejected doctors (`422 VALIDATION`, `details.doctorIds`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| TA/DA #39 (`6d66770`)                                          | `ExpenseCategory` gains `allowance` (response enum widened); `ExpenseLine` gains required `source` and `allowancePlaceId`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| POB/RCPA #40 (`72c770a`, `48a135c`)                            | POB line `value` is computed by the server (`quantity × PTR`, else `null`); a client-sent `value` is ignored. Before, it was stored as sent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Invite gaps (`a575db1`)                                        | `POST /v1/invites/accept`: password minimum 8 → 12; used/expired tokens now `409 INVITE_USED` / `410 INVITE_EXPIRED` instead of `404 INVITE_INVALID`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Security #81 (`2789b64`)                                       | `/docs` and `/openapi.json` are not served when `NODE_ENV=production`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Security #79 (`4dea14b`)                                       | Deactivation or role change revokes all sessions; suspended users get `ACCOUNT_SUSPENDED` on sign-in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Security #77 (`16e1116`)                                       | Auth, sign-up and invite-accept routes can return `429 RATE_LIMITED` with `Retry-After`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Health (`a72e145`)                                             | `HealthWarning` dropped `companyId` / `companySlug` and became aggregate (`NO_WORK_TYPES` with `count`). Only clients of `0c97952` are affected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| TP submit (`36c29f5`, superseded by `0bb7b40`)                 | `POST /v1/tour-plans/{month}/submit` 422 rule changed: weekly offs and past days of the current month (IST) are no longer required                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Product image (`feat/product-image`, migration 0047)

Additive. Products get a picture, uploaded from the product prices admin and shown in the DCR picker.

- `FilePurpose` gains `product_image` (snake_case like the others). `POST /v1/files/upload-url` with that
  purpose: `image/jpeg|png|webp` only, `sizeBytes` <= 5 MB (422 `VALIDATION` otherwise), needs
  `products:prices` (403 `FORBIDDEN`).
- `Product` (`GET /v1/products`, `/v1/products/{id}`, PATCH response) and `AdminProduct` (`GET /v1/admin/products`,
  price PATCH response) gain `imageFileKey: string|null` and `imageUrl: string|null`. `imageUrl` is a presigned
  R2 GET for `<img src>`, signed for 60 min from the start of a 30-min window (valid >= 30 min, same URL within
  the window). Null if no picture or storage is off. Not settable through product create/update/import.
- `AdminProduct` also gains `composition: string|null` and `packSize: string|null` (existing
  `products.composition` / `products.pack_size` columns; no migration).
- New `PUT /v1/products/{id}/image` `{fileKey, version?}` -> 200 `AdminProduct` (new `version`, fresh `imageUrl`).
  The object is HEAD-checked in R2 (exists, <= 5 MB, allowed type matching the key extension) and its magic bytes
  sniffed; a rejected upload is deleted. Errors: 404 `PRODUCT_NOT_FOUND`, 403 `FORBIDDEN`, 409 `VERSION_CONFLICT`
  (only if `version` sent), 422 `VALIDATION` with `details.reason` `IMAGE_KEY_INVALID` | `UPLOAD_MISSING` |
  `UPLOAD_TOO_LARGE` | `UPLOAD_TYPE_INVALID` | `UPLOAD_FORMAT_INVALID`, 503 storage not configured.
- New `DELETE /v1/products/{id}/image` -> 200 `AdminProduct` (`imageUrl: null`; version bumped only if a picture
  was removed). Idempotent. The R2 object is kept for audit.
- Setting or clearing bumps the product `version`/`updatedAt` (row trigger), so `?updatedSince` syncs pick it up.
  Audit actions `product.image_set`, `product.image_cleared`, `product.image_rejected`.

## Territory link import + `localTerritoryId` (`feat/territory-importer`)

Additive (no migration; uses 0042). Web impact noted per item.

- New: `POST /v1/imports/territory-links` (`operationId importTerritoryLinks`), body
  `TerritoryLinkImportRequest` (`dryRun` default true, `onLinked` `keep`|`replace`, `rows` of
  `hq_code, entity, name_key, territory_text`), response `TerritoryLinkImportResult` (200 dry run /
  201 applied): `totals`, `territoriesCreated[]`, `nearDuplicates[]`, `results[]` with
  `TerritoryLinkRowStatus` and `TerritoryLinkReason`. Company-wide roles only; `x-required-permissions`
  `imports:write + territories:write + masters:write` (403 otherwise).
- `Doctor` and `Chemist` gain `localTerritoryId: uuid | null` (read-only, defaulted to null when
  parsing older payloads). Not accepted on create/update (ignored). Cleared by the server when a PATCH
  changes `territoryId`. `Stockist` unchanged (now `Chemist` minus `localTerritoryId`).
- `GET /v1/doctors` and `GET /v1/chemists`: new query `localTerritoryId` = territory id (exact) or
  `none` (not linked). Chemists use the new `ChemistListQuery`; stockists keep `OutletListQuery`.
- Applying creates `territories` rows with `level: 'territory'` (already in the enum since 0042):
  pickers that list `GET /v1/territories` will see them (filter by `level` / `assignableForRole`).
- Contracts exports: `planTerritoryLinks`, `territoryLinkResult`, `territoryKey`, `masterNameKey`,
  `territoryCodeFor`, `readTerritoryLinkRow`. MSW mock implements the endpoint (an `area` counts as an
  HQ in fixtures) and the filter; doctor/chemist fixtures carry `localTerritoryId: null`.

## Leave approval blocked by a submitted DCR (`fix/leave-approval-dcr-conflict`)

Additive error code. The final approval of a leave request (`POST /v1/leave/requests/{id}/decision`
or `POST /v1/approvals/{id}/decision` with `decision: approve`) returns `409 LEAVE_DCR_CONFLICT` when
the leave's user has a live submitted/approved DCR on any date from `fromDate` to `toDate` (half days
included): `details { dates: string[], dcrIds: string[] }`. Nothing is decided (the step stays
pending). Drafts never block; intermediate approval steps, reject and cancel are unaffected. Fix the
DCR (correction request) first. Submitting a DCR on an approved-leave day still returns
`422 LEAVE_DAY_BLOCKED`; both checks are serialised per user, so they cannot both pass.

## Drafts ignored by team calendar, leave clash, team attendance (`fix/drafts-ignored-calendar-leave`)

No contract or DB change. `GET` team calendar (attendance days), the full-day leave apply clash
(`409 LEAVE_DCR_EXISTS`) and the team-profile attendance buckets use only live submitted/approved
DCRs. A draft no longer blocks applying for leave; submitting a field/non-field draft on an
approved-leave day still fails with `422 LEAVE_DAY_BLOCKED` (`details.dates`). TA/DA, expense
reconcile, correction requests and the team-profile today badge keep the draft fallback.

## KPIs count submitted DCRs only (`fix/kpi-submitted-only`, migration 0046)

No contract change. `kpi_user_day` and `dcr_day_calls` now include only live `submitted`/`approved`
DCRs (0045 fell back to the latest draft). Drafts never count in KPIs (calls, POB, coverage,
frequency, product, TP adherence, field/off days), and a drafts-only day has no `kpi_user_day` row,
so the exceptions engine flags it `dcr_missing` (or `punch_without_dcr` with a punch). TA/DA, expense
reconcile, correction requests, team calendar/profile day kinds and leave clash keep the 0045
fallback (submitted, else latest draft).

## DCR multi-draft (`feat/dcr-multi-draft`, migration 0045)

Several drafts per user and day; at most one submitted report per day (partial unique index
`dcrs_user_date_submitted_uq` on `(company_id, user_id, date)` where status is `submitted` or
`approved` and not deleted; replaces the full `dcrs_user_date_uq`).

- `PUT /v1/dcrs/draft`: optional `id`. With `id`: updates that draft (yours, still a draft, same date;
  404 otherwise, 409 `ALREADY_SUBMITTED` if it is no longer a draft, 422 `VALIDATION` on another date,
  409 `VERSION_CONFLICT`). Without `id`: creates a new draft; without `id` but with `version`: updates
  the latest draft of the date. 409 `DAY_ALREADY_SUBMITTED` (`details.existingId`) when the date has
  a submitted report. Soft-deleted drafts are never revived.
- New `DELETE /v1/dcrs/{id}` (field:write): 204; soft-deletes your draft with its calls and SFC
  choices. 404 (not found / not yours), 409 `ALREADY_SUBMITTED` (not a draft), 409 `DAY_LOCKED`.
- `POST /v1/dcrs/{id}/submit`: 409 `DAY_ALREADY_SUBMITTED` (`details.existingId`) when another report of
  the date is submitted (also on a concurrent-submit race). Other drafts of the day are kept.
- `GET /v1/dcrs/options`: adds `submitted: Dcr | null` and `drafts: Dcr[]` (newest first); `dcr` stays
  (submitted, else latest draft).
- `GET /v1/dcrs`: `mine=true` filter; list items carry `callCount`.
- `PUT /v1/dcrs` (legacy): edits the day report (submitted, else latest draft); can return 409
  `DAY_ALREADY_SUBMITTED`.
- New error code: `DAY_ALREADY_SUBMITTED`.
- Readers use the day report (submitted, else the latest draft): KPI views (`kpi_user_day`, and via
  the new `dcr_day_calls` view `kpi_user_doctor_month`, `kpi_user_month`, `kpi_product_month`,
  `kpi_tp_adherence_month`), exceptions `dcr_missing`, expense reconcile, TA/DA, team calendar and
  profile, leave clash. A check-in counts as already linked only by a submitted report.

## Managers get field:write (`fix/manager-field-write`, migration 0044)

No schema change. `DEFAULT_ROLE_PERMISSIONS`: `field:write` added for ABM, RBM, ZBM, Sales Manager, GM,
VP and Director (`/v1/me` `permissions` and `GET /v1/roles` show it). Migration
`0044_manager_field_write` (generated by `db:role-perms`). They can now file their own DCRs.

## SFC HQ fallback (`fix/sfc-hq-fallback`)

Additive. `DcrSfcCandidate` and `DcrSfcSnapshot` gain optional `source` (`DcrSfcSource`: `own` | `hq`).
Behaviour: when the filer has no live SFC route on an HQ of the day, `GET /v1/dcrs/sfc-match`, draft
and submit use that HQ's routes from any owner (de-duplicated; `source: 'hq'`); own routes still win
per HQ. Submit accepts and snapshots a fallback route. No migration. See `docs/DCR-REDESIGN-DESIGN.md`.

## DCR redesign: multi-HQ, details, SFC snapshots (`feat/territory-city-split`)

Additive. Old `PUT /v1/dcrs` keeps working, except it now returns `409 ALREADY_SUBMITTED` for a DCR
submitted through the new flow.

- New: `GET /v1/dcrs/options`, `/territories`, `/work-with`, `/sfc-match`; `PUT /v1/dcrs/draft`;
  `POST /v1/dcrs/{id}/submit` (header `Idempotency-Key`, 1-128 chars).
- `Dcr` gains `band`, `details`, `workWithUserIds`, `sfcRoutes[] {hqTerritoryId, sfcRouteId, snapshot}`,
  `submittedBy` (all defaulted, so old payloads still parse).
- New error codes: `SFC_NO_MATCH` (404 on match, 422 on submit), `SFC_ROUTE_REQUIRED`, `SFC_MISMATCH`,
  `SFC_UNAVAILABLE` (503), `LEAVE_NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, `ALREADY_SUBMITTED`.
- `SfcCategory` import mapping: `EX`/`EX HQ` -> `ex`, `HQ` -> `hq`, `OS`/`OUT EX HQ`/`OUTSTATION` -> `os`;
  other values skip the row with a report line. Migration 0043. Reference: `docs/DCR-REDESIGN-DESIGN.md`.

## Forgot password + invite email (`feat/auth-email-otp`, item F)

Additive. New public `POST /v1/auth/password/forgot` (`PasswordForgot` -> `200 PasswordForgotAccepted`,
`422`, `429`) and `POST /v1/auth/password/reset` (`PasswordReset` -> `200 PasswordResetDone`;
`400 PASSWORD_RESET_CODE_INVALID`, `400 PASSWORD_RESET_CODE_EXPIRED`,
`403 PASSWORD_RESET_TOO_MANY_ATTEMPTS`, `422`, `429`). Constants `PASSWORD_RESET_*`,
`PASSWORD_RESET_ERROR_CODES`; MSW handlers with `MOCK_PASSWORD_RESET_CODE`. Behaviour: invites now
email the link; better-auth's own reset / email-OTP routes return 404. Production now requires
`RESEND_API_KEY` and `MAIL_FROM`. No migration. See `docs/AUTH-PASSWORD-RESET.md`.

## Territory levels, skipped ranks, SFC scope (`feat/sfc-routes`, Part 3)

- **`422 TERRITORY_LEVEL_INVALID`**: a BM may only hold `headquarter` territories; ABM and above may hold any level; `system_admin` targets are unrestricted. Checked on `POST /v1/team`, `POST /v1/team/invite-bulk` (row `code`), `PATCH /v1/team/{id}` (only when `role` or `territoryIds` is sent; unrelated PATCHes of a legacy BM still succeed), and `POST /v1/signup-requests/{id}/approve`. `details`: `{ territoryIds: string[], expectedLevel: 'headquarter', role }`. Applies to every caller, system_admin included.
- **`GET /v1/territories`**: new query `assignableForRole` (`RoleKey`); `business_manager` returns only `headquarter` rows. `level` filter unchanged. Invalid role: `422 VALIDATION`. **Dev: BM territory pickers must pass `assignableForRole=business_manager` (HQ only).** Contracts export `assignableTerritoryLevels(role)` and `TERRITORY_LEVELS`.
- **Approvals early finish** (behaviour, no schema change): when a higher-up (e.g. the RBM, or the Director) decides a step that belongs to someone below them, the request no longer escalates to a step owned by the decider or someone below them; it finishes. Skipped ranks (BM→RBM, ZBM→Director) were already allowed; a ZBM reporting to the Director gets a one-step approval.
- **SFC scope**: an employee is visible/editable when EITHER the reporting line (`managerId`) OR the territory tree covers them (they hold a territory inside one of the caller's territories and rank strictly lower). `canEdit` follows. No schema change.

## SFC routes (`feat/sfc-routes`)

Notes (confirmed in code): `da` is a nullable money amount (`numeric(12,2)`, contracts `Money`); the per-km rate is one global company setting (`companies.sfc_rate_per_km`).

**Additive:**

- New endpoints:
  - `GET`/`PUT /v1/sfc/settings`
  - `GET /v1/sfc/hqs`
  - `GET /v1/sfc/employees`
  - `GET`/`PUT /v1/sfc/employees/{userId}/routes`
- New schemas: `SfcSettings`, `SfcHq(List)`, `SfcEmployee(List)`, `SfcEmployeeQuery`, `SfcRoute`, `SfcRouteInput`, `SfcTable`, `SfcTablePut`, `SfcTravelMode`.
- New permissions: `sfc:read` and `sfc:write`. The `Permission` enum is widened (response enum).
- New error codes: 422 `SFC_HQ_NOT_ASSIGNED`, 422 `SFC_ROUTE_NOT_FOUND`, and 409 `VERSION_CONFLICT` (etag).
- **Deprecated (still served):** `/v1/allowance-rates*` and `/v1/allowance-places*` (`deprecated: true` in OpenAPI). The web "TA/DA rates" page is replaced by an SFC page. The claims endpoints are unchanged.

## System admin People page (list + edit)

Additive (new optional fields / params):

- `GET /v1/users`: items gain `primaryRole`, `rank`, `managerName`, `territories[] {id,name,code,level}` (primary first), `version`, `lastActiveAt` (latest live-session activity; null when signed out everywhere). New query `hasLogin=true|false`. Existing: `q` (name, employee code, email), `role`, `status`, `territoryId` (whole subtree), `managerId`, `sort=name|-name|employeeCode|-employeeCode` (id tiebreak), `limit` ≤ 200, `cursor`, `includeTotal`.
- `EmployeeUpdate` (`PATCH /v1/employees/{id}`): new optional `email`, `employeeCode` (system admin only); `territoryIds` may be `[]` (functional roles only); `managerId` accepts `null` (system admin only).
- New error codes: 409 `EMAIL_LOCKED_HAS_LOGIN`, 409 `EMAIL_TAKEN`, 409 `EMPLOYEE_CODE_TAKEN`, 422 `LAST_SYSTEM_ADMIN`, 422 `REPORTS_OUTRANK` (`details.userIds`), 422 `MANAGER_RANK`.

Breaking (behaviour, same request):

- A non-admin sending `email` or `employeeCode` on PATCH gets 403 (was silently ignored).
- System admin PATCH: changing role re-checks the kept manager (422 `MANAGER_RANK`) and direct reports (422 `REPORTS_OUTRANK`); moving to director or a functional role clears `managerId`.
- PATCH and `POST /v1/team/{id}/manager` now move pending approval steps: a person's pending first step follows them to the new manager; steps waiting on a person who is suspended or drops below ABM move to that person's manager (audit `approval.steps_reassigned`).
- PATCH `version` is also enforced in the UPDATE (concurrent edits get 409 `VERSION_CONFLICT`).

## System admin invites any role / any territory

- Additive. `EmployeeCreate.territoryIds` now defaults to `[]` (was required, min 1). Hierarchy roles still need at least one (422 `VALIDATION` "Hierarchy roles need at least one territory"); functional roles (`distribution_head`, `accountant`, `system_admin`) may send none.
- Behaviour, `system_admin` with `users:write` only: `POST /v1/employees`, `POST /v1/employees/invite-bulk`, `PATCH /v1/employees/{id}` and `POST /v1/employees/{id}/invite` accept any role (all hierarchy roles incl. `director`, plus `distribution_head`, `accountant`, `system_admin`) and any non-deleted territory in the company. Was 403 for functional roles / functional-role targets. Self is still 403.
- New 422 `VALIDATION` "Functional roles have no manager" when `managerId` is sent for a functional role. Changing a user to a functional role clears its manager.
- `UserSummary` (`GET /v1/users`) gains optional `hasLogin`, `inviteStatus` (`none|pending|expired|accepted`) and `inviteExpiresAt` (latest unused, unrevoked invite). `GET /v1/users` is already company-wide for `system_admin` and directors.
- Non-admin rules are unchanged. No migration.

## TP per-day submissions #86

- Additive: `TourPlan.days[].status`, `.submissionId`; `TourPlan.submissions[]`
  (`TourPlanSubmission`); `TourPlanSubmit.dates?`; `TourPlanCalendar.days[]`;
  `ApprovalSubjectTourPlan.submission`; new enum `TourPlanDayStatus`.
- New error code `DAY_LOCKED` (409) on `PUT /v1/tour-plans/{month}` and
  `POST /v1/tour-plans/{month}/submit`.
- Breaking: see the table above. Migration `packages/db/migrations/0037_tour_plan_submissions.sql`.

## Approvals detail + rejection reasons

- Branch `feat/approvals-detail` (from `6d23708`). Migration `0036_tour_plan_submitter_note`
  (adds `tour_plans.submitter_note`, re-runnable). Doc: `APPROVALS.md`.
- Added `GET /v1/approvals/{id}` → `ApprovalDetail` (`Approval` + `subject`, discriminated by
  `type`: `ApprovalSubjectTourPlan`, `ApprovalSubjectLeave`, `ApprovalSubjectExpense`,
  `ApprovalSubjectDoctor`, `ApprovalSubjectDcrUnlock`). Additive.
- Added response fields (additive): `rejectionReason`, `rejectedBy`, `rejectedAt` on `TourPlan`,
  `LeaveRequest`, `ExpenseClaim`, `ExpenseClaimSummary`; optional `rejectionReason` on `Approval`.
  `rejectedBy` is a `UserRef` `{ id, name }`. `Doctor` gains optional `rejectionReason`,
  `rejectedBy`, `rejectedAt` (from the latest approval decision; on `GET /v1/doctors` and
  `GET /v1/doctors/{id}`; null for viewers outside the adder's line or the approvers).
- Added `GET /v1/tour-plans/{id}`: the `{month}` path segment also accepts a plan id. Owner, the
  reporting line with `field:read`, or an assigned approver (current or past step); else 404.
- Added optional body `TourPlanSubmit { submitterNote?: string ≤1000 }` on
  `POST /v1/tour-plans/{month}/submit`; `TourPlan.submitterNote` (also the approval `reason`).
- Added `GET /v1/doctors?ids=a,b,c`: 1–100 comma-separated uuids, `422 VALIDATION` otherwise;
  scoped like the list (out-of-scope ids are silently absent). Use `limit=100`.
- Assigned approvers can read `GET /v1/doctors/{id}` even outside their territory scope.
- Changed request bodies `ApprovalDecision`, `LeaveDecision`, `ExpenseDecision`: `comment` is
  trimmed; the reject rule moved from the schema refine to the server
  (`422 REJECTION_REASON_REQUIRED`). `SignupReject.reason` is now required by the server.
  **Breaking** (see table).
- Notifications: new types `tour_plan.approved`, `tour_plan.rejected`, `doctor.approved`,
  `doctor.rejected`, `dcr_unlock.rejected` (`data.comment`, `data.approvalId`, `actorName`; deep
  link via `entityType`/`entityId`);
  `data.reason` on all rejections. **Breaking** (widened enums).
- MSW mocks: `GET /v1/approvals/:id`; reason rule on approvals, leave, expense and sign-up mocks.

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

## Tour plan submit: one planned day, EMPTY_PLAN

- Branch `fix/tp-submit-any-day`, commit `0bb7b40`; merged into this line with a no-ff merge at
  `74ab9a9`. No migration. Doc: `TOUR-PLANS.md`.
- Changed `POST /v1/tour-plans/{month}/submit`: succeeds with at least one day that has an entry;
  otherwise `422 EMPTY_PLAN`. Supersedes the missing-dates rule of `36c29f5`. Past dates stay
  editable in a draft. Weekly offs come from `leave_settings.weekly_off_days`.
- `GET /v1/tour-plans/{month}/calendar` unchanged in shape; `requiredDates` is informational and
  `requiredDates` / `missingRequiredDates` helpers are deprecated (`hasPlannedDay` replaces them).
- Breaking for web clients that read `details.missingDates`.

## Tour plan submit rule and calendar

- Branch `fix/tp-submit-past-days`, commit `36c29f5`. No migration. Doc: `TOUR-PLANS.md`.
- Added `GET /v1/tour-plans/{month}/calendar` (`TourPlanCalendar`).
- Changed `POST /v1/tour-plans/{month}/submit`: `422` with `details { missingDates, todayIST,
weeklyOffDays }`; required dates are non-weekly-off dates, and in the current month (IST) only
  today and later.
- Superseded by `0bb7b40` (see above): the missing-dates 422 no longer applies.

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

- `PATCH /v1/doctors/{id}` re-pending and the RCPA error details are from the feature docs only.
- `GET /v1/users` (`c067e17`) and `GET /v1/approvals` (`ddcb66e`) changed in OpenAPI only in their
  operation text; no parameter or response change was found.
- Leave backdating: SQL default 7 vs API default 14.
