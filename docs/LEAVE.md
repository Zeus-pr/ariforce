# Leave management (#51)

Backend only. Leave types and their quotas are **data** (`leave_policies`), not code; each company gets the defaults below and can change them with `PUT /v1/leave/types/{code}`.

## Defaults (seeded per company by migration 0023, and lazily by the API for new companies)

| Code   | Name             | Paid | Annual quota | Carry forward | Notes                                   |
| ------ | ---------------- | :--: | -----------: | ------------- | --------------------------------------- |
| `CL`   | Casual leave     |  ✓   |           12 | no            |                                         |
| `SL`   | Sick leave       |  ✓   |           12 | no            |                                         |
| `EL`   | Earned leave     |  ✓   |           15 | yes, cap 30   |                                         |
| `LOP`  | Loss of pay      |      |    unlimited | no            | `annual_quota` null = unlimited         |
| `COMP` | Compensatory off |  ✓   |  0 (granted) | no            | `grant_only`: balance comes from grants |

Half days are allowed for every default type (`half_day_allowed`).

`leave_settings` (one row per company): `approval_levels` (default 2), `backdate_days` (default 7), `weekly_off_days` (default `{0}` = Sunday), `max_future_days` (default null = up to 31 Dec of the current year).

## States

`pending` → `approved` | `rejected` (approval engine) ; `pending` | `approved` → `cancelled`.

- Apply creates a `pending` request and an `approval_requests` row (entity `leave`) on the same chain as expenses/DCRs: step N goes to the N-th manager up the reporting line, anyone above the step approver may decide, never your own request, never two steps by the same person. Levels come from `leave_settings.approval_levels`.
- Reject needs a comment (422 from the engine).
- Cancel: the owner may cancel `pending`, or `approved` before `from_date`; a manager above the owner may cancel `pending` or `approved` at any time. Cancelling a pending request also cancels its approval. Cancelled/rejected days return to the balance.

## Balances

Per type and calendar year: `available = opening + carriedForward + quota + granted − used − pending` (`opening` grants and `carry_forward` grants are reported in `opening`/`carriedForward`; `grant` and `adjustment` in `granted`). Unlimited types return `available: null`. Days are counted dates in the range minus weekly offs; a half day is 0.5.

## Endpoints (`/v1/leave`, all need a session)

| Method / path                   | Permission                                       | Body / query → response                                                                                      |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `GET types`                     | `me:read`                                        | → `LeaveTypeList`                                                                                            |
| `PUT types/{code}`              | `settings:write`                                 | `LeaveTypeUpdate` (creates new codes; `version` for optimistic lock) → `LeaveType`                           |
| `GET settings` / `PUT settings` | `me:read` / `settings:write`                     | `LeaveSettingsUpdate` → `LeaveSettings`                                                                      |
| `GET balances`                  | `leave:read` (others: `leave:approve` over them) | `?userId&year` → `LeaveBalance`                                                                              |
| `GET requests`                  | `leave:read`                                     | `?status&userId&year&mine&from&to` → `LeaveRequestList` (own; with `leave:approve` also your reporting line) |
| `POST requests`                 | `leave:write`                                    | `LeaveApply {typeCode, fromDate, toDate, half: am/pm/null, reason}` → 201 `LeaveRequest`                     |
| `GET requests/{id}`             | `leave:read`                                     | → `LeaveRequest`                                                                                             |
| `POST requests/{id}/cancel`     | `leave:read` (owner or manager above)            | `{reason}` → `LeaveRequest`                                                                                  |
| `POST requests/{id}/decision`   | `leave:approve` + `approvals:decide`             | `{decision: approve/reject, comment}` → `LeaveRequest`                                                       |
| `GET grants` / `POST grants`    | `leave:read` / `leave:approve`                   | `LeaveGrantCreate {userId, typeCode, year, kind, days, workedDate, reason}` → 201 `LeaveGrant`               |
| `POST carry-forward`            | `settings:write`                                 | `{fromYear}` → `LeaveCarryForwardResult` (idempotent)                                                        |
| `GET calendar`                  | `leave:read`                                     | `?from&to (≤ 92 days)&userId&includePending` → `LeaveCalendar` (team with `leave:approve`, else yourself)    |

## Error codes

| Code                         | HTTP | When                                                                                                 |
| ---------------------------- | ---: | ---------------------------------------------------------------------------------------------------- |
| `LEAVE_TYPE_UNKNOWN`         |  422 | Unknown/inactive type (apply, grant)                                                                 |
| `LEAVE_HALF_DAY_NOT_ALLOWED` |  422 | Type has `half_day_allowed = false`                                                                  |
| `LEAVE_SPANS_YEARS`          |  422 | from and to in different years — split the request                                                   |
| `LEAVE_BACKDATE_WINDOW`      |  422 | Start older than `backdate_days`; `details.earliest`                                                 |
| `LEAVE_TOO_FAR_AHEAD`        |  422 | Start after the future limit; `details.latest`                                                       |
| `LEAVE_NO_WORKING_DAYS`      |  422 | Every date is a weekly off                                                                           |
| `LEAVE_INSUFFICIENT_BALANCE` |  422 | `details.available`, `details.requested`                                                             |
| `LEAVE_OVERLAP`              |  409 | Pending/approved leave on the same dates (am + pm on one date is fine); `details.requestIds`         |
| `LEAVE_DCR_EXISTS`           |  409 | A field/non-field DCR already exists on a full leave day; `details.dates`                            |
| `LEAVE_NOT_CANCELLABLE`      |  409 | Not pending/approved, or the owner cancelling approved leave that started                            |
| `LEAVE_SELF_GRANT`           |  403 | Granting days to yourself                                                                            |
| `LEAVE_DAY_BLOCKED`          |  422 | Tour plan entry or DCR (field/non-field work type) on an approved leave day or half; `details.dates` |
| `CONFLICT`                   |  409 | Deciding a request that is no longer pending                                                         |
| `VERSION_CONFLICT`           |  409 | Stale `version` on types/settings                                                                    |

## Integrations

- **Attendance** (`GET /v1/attendance`): a day with approved leave and no punch-in is `leave` (not `absent`); every row has `leave: {requestId, typeCode, half} | null`. Pending leave still shows `absent`.
- **KPIs**: off days = union of leave/holiday DCR days and the `kpi_user_leave_day` view (approved leave, weekly offs excluded), max fraction per user-day, Sundays excluded. They come off the working-day denominator of DCR compliance.
- **Tour plans**: entries on approved leave days must use leave/holiday work types (`LEAVE_DAY_BLOCKED`); submit does not require entries on full leave days.
- **DCR**: `PUT /v1/dcrs` with a field/non-field work type on a full approved leave day returns `LEAVE_DAY_BLOCKED`.

## Migrations (apply in order)

1. `packages/db/migrations/0023_leave.sql` — tables `leave_settings`, `leave_policies`, `leave_requests`, `leave_grants`; checks, indexes, default rows, RLS (forced, `tenant_isolation` on `company_id`), row-meta triggers, grants to `ariforce_app` only.
2. `packages/db/migrations/0024_kpi_leave_views.sql` — view `kpi_user_leave_day` (security_invoker).
3. `packages/db/migrations/0025_role_permissions_leave.sql` — re-syncs role permissions from `DEFAULT_ROLE_PERMISSIONS` (drift test: `packages/db/test/role-permissions.test.ts`).

All three are re-runnable.

## Assumptions (to confirm)

- Leave year = calendar year; full quota up front (no pro-rata for joiners); a request cannot span years.
- No company holiday master exists yet, so only `weekly_off_days` are excluded from counted days. Holidays inside a leave range are counted as leave.
- Comp-off is granted manually by a manager (`POST grants`, kind `grant`, `workedDate`); no automatic rule from Sunday DCRs.
- Carry-forward is run by a `settings:write` holder (`POST carry-forward`); carries `min(cap, available)` of carry-forward types into a `carry_forward` grant for the next year. No lapse/encashment.
- Approval levels are per company in `leave_settings` (default 2), not an env var.
- Functional roles (Distribution Head, Accountant) and System Admin have no leave permissions (no reporting line/approver). Director can approve and manage policy.
- A half day without punch-in is shown as `leave` in attendance.
