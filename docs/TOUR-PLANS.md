# Tour plans and approvals

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
- `POST /v1/tour-plans/{month}/submit`: every date needs an entry (use leave/holiday work types) → else
  `422` with `details.missingDates`. Creates an approval request (step 1 approver = reporting manager).

## Approvals (gaps #5-#7)

- Visible: your own requests plus your reporting line's (company-wide roles: all).
- `mine=to_decide`: pending requests from your reporting line, never your own (empty without approvals:decide).
  `mine=requested`: yours.
- Decide: approvals:decide and the requester must be below you in the reporting line (any level, not only the direct
  manager). Own request → 403; outside your line → 404; already decided → 409; reject needs a comment (422).
- Tour plan decisions set `status`, `decidedAt/By`, `decisionComment` on the plan.
