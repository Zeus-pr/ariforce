# Notifications and background jobs (#35)

Scope now: a DB-backed job runner and the **in-app** channel. Email / SMS / Expo push are not built
yet (no delivery channel chosen), but the model and code leave room for them without schema changes.

## Data model (migration `0028_notifications_jobs`)

`notifications`: the in-app inbox. RLS: tenant (`company_id = app_company_id()`) **and** owner
(`user_id = app_user_id()`) for SELECT/UPDATE, so a request can only ever see or mark its own rows.
INSERT only checks the tenant (the job worker creates rows for other users). No DELETE grant.

| column                                   | notes                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `id`, `company_id`, `user_id`            | recipient = `user_id`                                                            |
| `type`                                   | event code, e.g. `leave.approved` (see "Event types")                            |
| `title`, `body`                          | rendered once by the server (English)                                            |
| `entity_type`, `entity_id`, `data` jsonb | deep-link data for the client (`leave_request` / `expense_claim`)                |
| `dedupe_key`                             | unique per `(user_id, dedupe_key)`: replaying a job never doubles a notification |
| `read_at`, `created_at`                  | unread = `read_at is null`                                                       |

`notification_deliveries`: one row per (notification, external channel) for later channels
(`email`, `sms`, `push`): `status pending|sent|failed|skipped`, `attempts`, `last_error`,
`sent_at`, unique `(notification_id, channel)`. Unused today (in-app needs no delivery row).
Preferences (`user + type + channel`) are not built; when added they only decide which delivery rows
to create.

`jobs`: the queue. `id, company_id (null = system job), type, payload jsonb, status
queued|running|done|dead, run_at, attempts, max_attempts (default 5), locked_at, locked_by,
last_error, dedupe_key` (unique per `type` while set), timestamps.
RLS: tenant rows only (`company_id = app_company_id()`); the app role may INSERT/SELECT its own
company's jobs inside a request transaction. Cross-company work goes through SECURITY DEFINER
functions with a fixed `search_path`, executable only by `ariforce_app`:

- `jobs_claim(worker, n, lock_timeout_s)`: one statement = one transaction (works under the
  transaction pooler): `UPDATE jobs SET status='running', locked_at=now(), locked_by=worker,
attempts=attempts+1 WHERE id IN (SELECT id ... WHERE (status='queued' AND run_at<=now()) OR
(status='running' AND locked_at < now()-timeout) ORDER BY run_at LIMIT n FOR UPDATE SKIP LOCKED)
RETURNING *`. Two workers never get the same job; a crashed worker's job is reclaimed after the
  lock timeout.
- `jobs_finish(id, lock_token)` → `done` (only if still locked with this token; see Hardening).
- `jobs_fail(id, worker, error, retry_after_s)` → back to `queued` with `run_at = now()+retry`, or
  `dead` once `attempts >= max_attempts`. Errors are truncated to 500 chars.
- `jobs_enqueue_system(type, payload, run_at, dedupe_key)`: system jobs (company null), e.g. cleanup.
- `jobs_cleanup(read_days, done_days)`: deletes read notifications older than `read_days` (90) and
  `done` jobs older than `done_days` (14). Dead jobs are kept for inspection.

### Hardening (migration `0030_jobs_functions_hardening`)

0028 is applied live and is not edited; 0030 replaces the function bodies (`CREATE OR REPLACE`,
`jobs_claim` is dropped and re-created because its result gained a column) and re-applies grants.

**Threat model.** Every API process, request handlers and the runner alike, connects as `ariforce_app`
through the transaction pooler. The SECURITY DEFINER functions run as the owner and bypass RLS, so
a bug in request code, or SQL injection, could call them with arbitrary arguments. Risks in 0028:
finishing/failing any job by guessing a worker name (`host:pid:8 hex`), claiming other companies'
jobs and reading their payloads, enqueuing arbitrary system jobs (company null) that the runner
then executes without a tenant, and calling `jobs_cleanup(0, 0)` to wipe all read notifications.

**Chosen fix (option b, safe by construction).** Option (a), a NOLOGIN `ariforce_worker` role
entered with `SET LOCAL ROLE`, was skipped: `ariforce_app` would need membership in it, and
membership is per role, not per code path, so any request transaction (or injected SQL) could run
`SET LOCAL ROLE ariforce_worker` too. It would add a role to provision without closing the hole.
A runner secret checked against a DB setting was skipped too: it would be a new secret to provision
and rotate, and the app role can read anything it can pass in, so it only helps against injection
that cannot read env vars. Instead:

- `jobs_claim`, `jobs_cleanup` and `jobs_enqueue_system` call `jobs_assert_runner()` and fail with
  `42501` inside a tenant transaction (`app.current_company_id` set, i.e. every `withTenant` /
  request transaction). This blocks honest misuse from request code. It is **not** a boundary
  against arbitrary SQL, which can leave the setting empty.
- `jobs_claim` stores a per-job lock token `worker/<random uuid>` in `locked_by` and returns it as
  `job_lock_token`. `jobs_finish` / `jobs_fail` need that exact token (the worker name alone no
  longer works), the job must still be `running`, and inside a tenant transaction the job must
  belong to that tenant. A job nobody claimed, or one claimed by another worker, cannot be completed
  or failed. Lock timeout has a 30 s floor and retry delay is capped at 1 day.
- `jobs_enqueue_system` accepts only known system job types (`maintenance.cleanup`), payloads up to
  4 KB and `run_at` at most 7 days ahead. Company jobs have no function: they are plain INSERTs
  under RLS, so they can only be enqueued for the caller's own company (direct inserts of system
  jobs are refused by RLS as well).
- `jobs_cleanup` floors win over arguments: read notifications are kept at least 30 days and `done`
  jobs at least 1 day, whatever is passed (null → 90 / 14). At most 50 000 rows per table per call;
  the daily job catches up. Unread notifications and `dead` jobs are never deleted, and there is no
  per-company delete.

**Residual risk.** Arbitrary SQL as `ariforce_app` can still claim queued jobs (delaying them until
the lock timeout and reading their payloads) and run cleanup at the floors. Closing that needs a
separate login (a worker-only DB user and pool, e.g. `JOBS_DATABASE_URL`), a deployment change for
later. Deploy note: the new runner code passes `job_lock_token`. An old runner against 0030 can
still claim, but its `jobs_finish` returns false and the job is retried after the lock timeout;
deploy API and migration together.

## Runner (`apps/api/src/jobs`)

- `JobsRunner` polls every `JOBS_POLL_MS` (default 2000) and claims `JOBS_BATCH_SIZE` (default 10).
- Enabled by `JOBS_RUNNER_ENABLED`: default **on** when `NODE_ENV=production`, off otherwise
  (tests call `runner.runOnce()` directly). Set it to `false` on instances that must not run jobs.
- Each job: company jobs run inside `withTenant({ companyId })` (RLS applies, no user), system jobs
  get a plain transaction. Success → `jobs_finish`; error → `jobs_fail` with exponential backoff
  `min(30s * 2^(attempts-1), 1h)`; after `max_attempts` the job is `dead` and an error is logged.
- Handlers are idempotent (notifications use `dedupe_key` + `ON CONFLICT DO NOTHING`).
- Graceful shutdown: stop polling, wait for the in-flight batch (Nest `enableShutdownHooks`).
- A job left `running` longer than `JOBS_LOCK_TIMEOUT_S` (default 300) is reclaimed by the next
  claim (attempts +1) with a new lock token; the stale worker's `jobs_finish` then returns false.
- Once a day (any runner tick) it enqueues `maintenance.cleanup` with `dedupe_key = YYYY-MM-DD`, so
  only one instance does it.

## Events → notifications

Business code calls `NotificationsService.enqueue(tx, p, event)` **inside the same transaction**
as the change, wrapped in a savepoint: if enqueueing fails it is logged and the business action still
commits. The job (`notify`) renders and inserts the notification.

| type                                    | when                                                                                                                        | recipient                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `leave.submitted`                       | leave applied; also each higher approval step                                                                               | current approver                                        |
| `leave.approved` / `leave.rejected`     | final decision                                                                                                              | requester                                               |
| `leave.cancelled`                       | cancelled by a manager → requester; by the owner while pending → approver                                                   |                                                         |
| `expense.submitted`                     | claim submitted/resubmitted; also each higher step                                                                          | current approver                                        |
| `expense.approved` / `expense.rejected` | final decision                                                                                                              | claimant                                                |
| `expense.paid`                          | marked paid                                                                                                                 | claimant                                                |
| `exceptions.digest`                     | daily exceptions job (#56): one per manager per run, new exceptions of direct reports; dedupe `exceptions:<runDate>`        | direct manager                                          |
| `tour_plan.approved`                    | tour plan finally approved (`data.comment`, approver in `actorName`)                                                        | requester                                               |
| `tour_plan.rejected`                    | tour plan rejected (body has `Reason:`; `data.reason`)                                                                      | requester                                               |
| `doctor.approved`                       | added doctor finally approved (`data.comment`, approver in `actorName`)                                                     | requester                                               |
| `doctor.rejected`                       | field-added doctor rejected (body has `Reason:`; `data.reason`)                                                             | requester                                               |
| `dcr_unlock.rejected`                   | DCR correction rejected (body has `Reason:`; `data.reason`; entityType `approval_request`)                                  | requester                                               |
| `company.message`                       | director or system admin sends a company message (`POST /v1/notifications/company`)                                         | every other active user                                 |
| `doctor.occasion`                       | daily, company-local date: a doctor's birthday or anniversary is today or within 5 days (year ignored; blank dates skipped) | BM on that HQ (and local territory) plus managers above |

Nobody is notified about their own action (recipient = actor is skipped).

## Channels

`NotificationChannel { key: 'in_app'|'email'|'sms'|'push'; deliver(notification, recipient) }`.
`in_app` is the `notifications` row itself. After that row is inserted, the `notify` handler
enqueues `notification.deliver`, which sends an Expo push when the user's phone has registered a
token (`POST /v1/devices/{id}/push-token`). No token, or a dead token, is recorded as `skipped`
and the inbox row stays. Email and SMS are still unused.

## API (own notifications only)

- `GET /v1/notifications?limit=1..100&cursor=&unreadOnly=true|false` →
  `{ items: Notification[], nextCursor: string|null, serverTime }` newest first (keyset cursor on
  `created_at, id`).
- `GET /v1/notifications/unread-count` → `{ count }`
- `POST /v1/notifications/{id}/read` → `Notification` (idempotent; 404 if not yours)
- `POST /v1/notifications/read-all` → `{ updated }`
- `POST /v1/notifications/company` `{ title, body }` → `{ recipients }` (director or system admin;
  the sender is not a recipient)
- `GET /v1/jobs/stats` (system_admin only, own company) → `{ queued, running, done, dead }`.

## Known gaps

- No per-user notification preferences yet (every listed event is delivered in-app).
- No email or SMS yet. Phone push goes out through Expo when a device has a token.
- No realtime push to the web app; clients poll `GET /v1/notifications/unread-count`.
- A new phone build is required before Android shows the banner. The inbox works on the current app.
- Job health is a count endpoint only; dead jobs are logged, not alerted.

Tour plans (#86): `tour_plan.approved` / `tour_plan.rejected` are sent once per submission;
`entityId` stays the plan id.
