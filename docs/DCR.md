# Daily Call Report (DCR)

Endpoints (`apps/api/src/dcr`; contract in `packages/contracts`, mock in `src/mocks`):

| Method | Path                           | Permission  | Notes                                                                                                         |
| ------ | ------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/dcrs`                     | field:read  | Team-scoped; filters `from`, `to`, `userId`, `territoryId` (subtree), `status` (`draft`/`submitted`/`locked`) |
| GET    | `/v1/dcrs/:id`                 | field:read  | 404 outside the reporting line                                                                                |
| PUT    | `/v1/dcrs`                     | field:write | Own DCR for one date; idempotent by `date` + call `clientId`                                                  |
| POST   | `/v1/dcrs/correction-requests` | field:write | Ask the manager to unlock a locked day (gap #8)                                                               |

## Rules enforced server-side

- **Future date**: 422.
- **Day lock**: `lockAt = end of the day in the company timezone + dcrLockAfterHours` (default 24 h). Saving after `lockAt` returns 409 `DAY_LOCKED`. An approved `dcr_correction` (subjectType `dcr_unlock`) unlocks the day for `DCR_UNLOCK_HOURS` (48 h) from the decision; `unlockedUntil` shows it.
- **Version**: a stale `version` returns 409 `VERSION_CONFLICT` with the current row.
- **Work type**: calls are only allowed on `field` work types; submitting a field day needs at least one call.
- **Tour plan**: `tourPlanId` is set to the user's approved plan for that month. If the worked work type or territories differ from the plan's entries for the date (`isDeviation`), `deviationReason` is required: 422 `DEVIATION_REASON_REQUIRED`.
- **Calls**: `clientId` becomes the call id (resends update; calls left out are soft-deleted). Outlets must be in scope, products and joint-work users must exist, `checkInId` must be the caller's own visit check-in at that outlet and not linked to another call. A `clientId` owned by another DCR is 409 `IDEMPOTENCY_CONFLICT`.
- **Correction request**: 409 if the day is not locked (or already unlocked); a new request supersedes a pending one.

## Storage

Migration `0013_dcr_detail.sql` adds `dcrs.territory_ids`, `dcrs.tour_plan_id` and `dcr_calls.joint_work_user_ids`. Product lines live in `dcr_call_products` (`detailed` with `seq`, `sample`, `pob` with `stockist_id`/`value`).
