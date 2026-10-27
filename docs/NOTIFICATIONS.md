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
- `jobs_finish(id, worker)` → `done` (only if still locked by this worker).
- `jobs_fail(id, worker, error, retry_after_s)` → back to `queued` with `run_at = now()+retry`, or
  `dead` once `attempts >= max_attempts`. Errors are truncated to 500 chars.
- `jobs_enqueue_system(type, payload, run_at, dedupe_key)`: system jobs (company null), e.g. cleanup.
- `jobs_cleanup(read_days, done_days)`: deletes read notifications older than `read_days` (90) and
  `done` jobs older than `done_days` (14). Dead jobs are kept for inspection.

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
  claim (attempts +1); the stale worker's `jobs_finish` then returns false.
- Once a day (any runner tick) it enqueues `maintenance.cleanup` with `dedupe_key = YYYY-MM-DD`, so
  only one instance does it.

## Events → notifications

Business code calls `NotificationsService.enqueue(tx, p, event)` **inside the same transaction**
as the change, wrapped in a savepoint: if enqueueing fails it is logged and the business action still
commits. The job (`notify`) renders and inserts the notification.

| type                                    | when                                                                      | recipient        |
| --------------------------------------- | ------------------------------------------------------------------------- | ---------------- |
| `leave.submitted`                       | leave applied; also each higher approval step                             | current approver |
| `leave.approved` / `leave.rejected`     | final decision                                                            | requester        |
| `leave.cancelled`                       | cancelled by a manager → requester; by the owner while pending → approver |                  |
| `expense.submitted`                     | claim submitted/resubmitted; also each higher step                        | current approver |
| `expense.approved` / `expense.rejected` | final decision                                                            | claimant         |
| `expense.paid`                          | marked paid                                                               | claimant         |

Nobody is notified about their own action (recipient = actor is skipped).

## Channels

`NotificationChannel { key: 'in_app'|'email'|'sms'|'push'; deliver(notification, recipient) }`.
`in_app` is the `notifications` row itself. A future channel registers an implementation, the
`notify` handler creates `notification_deliveries` rows for it and enqueues
`notification.deliver` jobs; no schema change needed.

## API (own notifications only)

- `GET /v1/notifications?limit=1..100&cursor=&unreadOnly=true|false` →
  `{ items: Notification[], nextCursor: string|null, serverTime }` newest first (keyset cursor on
  `created_at, id`).
- `GET /v1/notifications/unread-count` → `{ count }`
- `POST /v1/notifications/{id}/read` → `Notification` (idempotent; 404 if not yours)
- `POST /v1/notifications/read-all` → `{ updated }`
- `GET /v1/jobs/stats` (system_admin only, own company) → `{ queued, running, done, dead }`.

## Known gaps

- No per-user notification preferences yet (every listed event is delivered in-app).
- No email / SMS / push channels yet; `notification_deliveries` exists for them.
- No realtime push to the web app; clients poll `GET /v1/notifications/unread-count`.
- Job health is a count endpoint only; dead jobs are logged, not alerted.
