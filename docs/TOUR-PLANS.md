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

## Per-day submissions (#86)

A month plan is no longer submitted and decided as one unit. Each planned day is submitted as part
of a **submission**, and each submission has its own approval request.

### Model

- New table `tour_plan_submissions` (migration
  `packages/db/migrations/0037_tour_plan_submissions.sql`): `tour_plan_id`, `user_id`,
  `dates date[]` (at least one), `status` (`submitted`/`approved`/`rejected`), `submitter_note`,
  `submitted_at`, `decided_at`, `decided_by`, `decision_comment`, plus the usual sync columns, RLS
  and the row-meta trigger.
- The approval request for a submission has `entity_type = 'tour_plan'` and
  `entity_id = submission id`; `payload = { month, planId, submissionId, dates }`. Using the
  submission id keeps two pending submissions of one month from cancelling each other
  (`approvals.request` cancels older pending requests for the same entity).
- Day status is derived, not stored on the day: the latest submission that contains the date
  gives `submitted`/`approved`/`rejected`; otherwise `draft`. A rejected day whose entries were
  removed reads as `draft`. A plan from before #86 with no submissions uses the plan status for
  all of its planned days.
- `tour_plans.status` is kept as a derived aggregate, updated after every save, submit and
  decision: `submitted` if any day is submitted; else `rejected` if any is rejected; else
  `draft` if some planned day is still unsubmitted; else `approved` (all planned days approved);
  an empty plan is `draft`.

### Rules

- `submitted` and `approved` days are locked. `PUT /v1/tour-plans/{month}` must send them back
  unchanged (same entries); changing or dropping one returns `409 DAY_LOCKED` with
  `details.dates`. Approved days stay locked even after they pass.
- Rejected and draft days can be edited. Editing does not change status: a rejected day stays
  `rejected` (reason visible) until it is resubmitted. New days can be added at any time.
- `POST /v1/tour-plans/{month}/submit` takes an optional `dates` (1-31 dates in the month). Without
  it, every planned day that is `draft` or `rejected` is submitted. A date outside the month is
  `422 VALIDATION`; a locked date is `409 DAY_LOCKED`; no planned day left is `422 EMPTY_PLAN`.
- Past days do not count toward any requirement (`requiredDates` is informational) and stay
  editable unless they are submitted or approved.
- Reject needs a reason (`422 REJECTION_REASON_REQUIRED`). The submitter reads the rejecter, the
  reason and the date on `submissions[]` (`rejectedBy`, `rejectionReason`, `rejectedAt`), and on
  the plan-level fields while the aggregate is `rejected` (taken from the latest rejected
  submission).

### API shape

- `TourPlan.days[].status` and `.submissionId` (response only; ignored on input).
- `TourPlan.submissions[]`: `{ id, tourPlanId, dates, status, approvalId, submitterNote,
submittedAt, decidedAt, decidedBy {id,name}, decisionComment, rejectionReason, rejectedBy
{id,name}, rejectedAt }`, oldest first.
- `GET /v1/tour-plans/{month}/calendar` gains `days[] { date, status, submissionId }`.
- `GET /v1/approvals/{id}` for a tour plan: `subject.plan` is the whole plan, `subject.submission`
  the submission, and `subject.days` only the submission's days.
- `GET /v1/tour-plans/{id}` is readable by an approver assigned to any of the plan's submissions
  (or a pre-#86 request on the plan id).

### Effects elsewhere

- DCR planned entries (`GET /v1/dcrs/{date}` plan) come only from approved days.
- Attendance joins the tour plan per day: approved submission containing the date, or a pre-#86
  approved plan.
- Exceptions `tp_not_submitted`: a plan counts as submitted if any submission is pending or
  approved.
- KPI view `kpi_tp_adherence_month` counts planned visits on approved days only (re-created in
  0037). Columns unchanged.
- Notifications: unchanged types (`tour_plan.approved` / `tour_plan.rejected`), sent per
  submission; `entityId` is still the plan id.

### Migration of existing data

0037 creates one submission per non-deleted plan in `submitted`/`approved`/`rejected` that has
planned days, carrying its status, decision and note, and re-points the plan's latest approval
request to it (`entity_id` = submission id, payload gains `planId`, `submissionId`, `dates`).
Plans without planned days are skipped (they read via the pre-#86 fallback). Older, superseded
approval requests keep the plan id; the decide hook falls back to the plan for those.
