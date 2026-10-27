# Tour plans and approvals

Submit rule: `0bb7b40` (`fix/tp-submit-any-day`), merged into `docs/hygiene-and-changelog` at `74ab9a9`.

## Storage

- `tour_plans.days` (jsonb, migration 0012) holds the canonical `TourPlanDay[]`. On every save the API rebuilds the derived
  rows: `plan_sessions` (one per entry; attendance leave/holiday + DCR prefill) and `tour_plan_visits` (planned doctors/
  chemists; read by `kpi_tp_adherence_month`, which only counts approved plans). Old derived rows are soft-deleted.
- `standard_tour_plans` (0012): one STP per user, `days` = `{ week 1-5, weekday 1-7 (Mon=1), entries }[]`.

## Endpoints

- `GET/PUT /v1/tour-plans/standard` (own; `?userId=` for team reads with field:read). 409 on stale `version`, 422 on
  duplicate week/weekday or unknown/out-of-scope references.
- `PUT /v1/tour-plans/{month}`: own draft. Editable when new, `draft` or `rejected` (a rejected plan goes back to draft);
  `submitted`/`approved` → 409. Dates must be in the month and unique; sessions are one `full` or `am`/`pm`;
  work types, territories (in your scope), planned doctors/chemists must exist → else 422 with details.
- `POST /v1/tour-plans/{month}/copy` `{ fromMonth?, fromStp = true }`: `fromMonth` wins; else `fromStp=true` copies the
  STP, `fromStp=false` copies the previous month. Dates map by week of month + weekday. Missing source → 404.
- `POST /v1/tour-plans/{month}/submit`: succeeds when the plan has **at least one day with an entry**. Any other date
  (past, weekly off, approved leave, or simply unplanned) may stay empty. A plan with no entries → `422`
  `{ error: { code: 'EMPTY_PLAN', message } }`. This supersedes the #19 "every date" rule. Shared helper:
  `hasPlannedDay` in `@ariforce/contracts`. Creates an approval request (step 1 approver = reporting manager).
- Past dates stay editable while the plan is a draft (no past-date lock).
- `GET /v1/tour-plans/{month}/calendar` → `{ month, todayIST, weeklyOffDays: number[], requiredDates: string[] }`
  (no plan needed). `weeklyOffDays` comes from `leave_settings.weekly_off_days` (default `[0]` = Sunday).
  `requiredDates` is **informational only** (kept for compatibility); it does not gate submit.
  `requiredDates`/`missingRequiredDates` helpers are deprecated.

## Approvals (gaps #5-#7)

- Visible: your own requests plus your reporting line's (company-wide roles: all).
- `mine=to_decide`: pending requests from your reporting line, never your own (empty without approvals:decide).
  `mine=requested`: yours.
- Decide: approvals:decide and the requester must be below you in the reporting line (any level, not only the direct
  manager). Own request → 403; outside your line → 404; already decided → 409; reject needs a comment (422).
- Tour plan decisions set `status`, `decidedAt/By`, `decisionComment` on the plan.
