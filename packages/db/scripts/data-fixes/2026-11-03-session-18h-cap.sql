-- ONE-OFF DATA FIX, run by lead as DB owner via the migration executor. NOT a migration.
-- DO NOT run from the app or CI.
-- Purpose: existing auth_session rows were created under the old (longer) lifetime; make them respect
-- the new hard 18 h cap from sign-in (PR 88, SESSION_MAX_AGE_SECONDS default 64800).
-- EFFECT: signs out everyone (web cookie and mobile bearer) who signed in more than 18 hours ago.
-- Shortens only (least()); never extends a session. auth_session is not company-scoped, so no slug.
-- Apply after PR 88 is deployed. If SESSION_MAX_AGE_SECONDS is changed from 64800, change the interval.
-- DRY RUN BY DEFAULT (report + ROLLBACK); -v apply=1 commits. Idempotent: a second apply changes 0.
-- Run:  psql "$URL" [-v apply=1] -v ON_ERROR_STOP=1 -f 2026-11-03-session-18h-cap.sql
\if :{?apply}
\else
  \set apply 0
\endif
\set ON_ERROR_STOP 1
BEGIN;
SELECT count(*) AS sessions_total,
       count(*) FILTER (WHERE expires_at > created_at + interval '18 hours') AS to_shorten,
       count(*) FILTER (WHERE expires_at > now() AND created_at + interval '18 hours' <= now())
         AS active_now_signed_out
  FROM auth_session;
UPDATE auth_session SET expires_at = least(expires_at, created_at + interval '18 hours')
 WHERE expires_at > created_at + interval '18 hours';
SELECT count(*) FILTER (WHERE expires_at > created_at + interval '18 hours') AS remaining_over_cap
  FROM auth_session;
\if :apply
  COMMIT;
  \echo 'APPLIED'
\else
  ROLLBACK;
  \echo 'DRY RUN: rolled back. Re-run with -v apply=1 to commit.'
\endif
-- ROLLBACK: none possible (old expiry values are not kept); affected users simply sign in again.
