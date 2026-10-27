-- GENERATED from packages/db/drizzle/0028_notifications_jobs.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0028_notifications_jobs') THEN
    RAISE NOTICE 'skip 0028_notifications_jobs (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- #35 Notifications (in-app) + DB-backed job queue. Design: docs/NOTIFICATIONS.md.
-- Idempotent: IF NOT EXISTS / duplicate_object guards / DROP POLICY IF EXISTS / CREATE OR REPLACE.
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE IF NOT EXISTS "notification_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"data" jsonb,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS "jobs_ready_idx" ON "jobs" USING btree ("status","run_at");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX IF NOT EXISTS "jobs_dedupe_uq" ON "jobs" USING btree ("type","dedupe_key");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS "jobs_company_idx" ON "jobs" USING btree ("company_id","status");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_uq" ON "notification_deliveries" USING btree ("notification_id","channel");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS "notifications_inbox_idx" ON "notifications" USING btree ("company_id","user_id","created_at","id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS "notifications_unread_idx" ON "notifications" USING btree ("company_id","user_id") WHERE read_at is null;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE jobs FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS tenant_isolation ON jobs;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY tenant_isolation ON jobs TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT ON jobs TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE notifications FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS own_select ON notifications;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY own_select ON notifications FOR SELECT TO ariforce_app USING (company_id = app_company_id() AND user_id = app_user_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS own_update ON notifications;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY own_update ON notifications FOR UPDATE TO ariforce_app USING (company_id = app_company_id() AND user_id = app_user_id()) WITH CHECK (company_id = app_company_id() AND user_id = app_user_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS tenant_insert ON notifications;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY tenant_insert ON notifications FOR INSERT TO ariforce_app WITH CHECK (company_id = app_company_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT ON notifications TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT UPDATE (read_at) ON notifications TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS tenant_isolation ON notification_deliveries;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY tenant_isolation ON notification_deliveries TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON notification_deliveries TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- Claim up to p_limit ready jobs (or running ones whose lock timed out) across all companies.
-- One statement = one transaction, so it is safe under the transaction pooler. SKIP LOCKED: two
-- workers never claim the same row.
CREATE OR REPLACE FUNCTION jobs_claim(p_worker text, p_limit int, p_lock_timeout_s int)
RETURNS TABLE (job_id uuid, job_company_id uuid, job_type text, job_payload jsonb, job_attempts int, job_max_attempts int)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.jobs j
     SET status = 'running', locked_at = now(), locked_by = p_worker,
         attempts = j.attempts + 1, updated_at = now()
   WHERE j.id IN (
     SELECT c.id FROM public.jobs c
      WHERE (c.status = 'queued' AND c.run_at <= now())
         OR (c.status = 'running' AND c.locked_at < now() - make_interval(secs => p_lock_timeout_s))
      ORDER BY c.run_at, c.id
      LIMIT greatest(least(p_limit, 100), 1)
      FOR UPDATE SKIP LOCKED)
  RETURNING j.id, j.company_id, j.type, j.payload, j.attempts, j.max_attempts
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE OR REPLACE FUNCTION jobs_finish(p_id uuid, p_worker text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS (
    UPDATE public.jobs SET status = 'done', locked_at = NULL, last_error = NULL, updated_at = now()
     WHERE id = p_id AND locked_by = p_worker AND status = 'running' RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u)
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- Failure: back to queued after p_retry_s, or dead once attempts >= max_attempts.
CREATE OR REPLACE FUNCTION jobs_fail(p_id uuid, p_worker text, p_error text, p_retry_s int)
RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.jobs
     SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
         run_at = CASE WHEN attempts >= max_attempts THEN run_at
                       ELSE now() + make_interval(secs => greatest(p_retry_s, 0)) END,
         locked_at = NULL, locked_by = NULL, last_error = left(p_error, 500), updated_at = now()
   WHERE id = p_id AND locked_by = p_worker AND status = 'running'
  RETURNING status
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- System jobs (company_id NULL), e.g. the daily cleanup. Dedupe on (type, dedupe_key).
CREATE OR REPLACE FUNCTION jobs_enqueue_system(p_type text, p_payload jsonb, p_run_at timestamptz, p_dedupe text)
RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.jobs (id, company_id, type, payload, run_at, dedupe_key)
  VALUES (gen_random_uuid(), NULL, p_type, coalesce(p_payload, '{}'::jsonb), coalesce(p_run_at, now()), p_dedupe)
  ON CONFLICT (type, dedupe_key) DO NOTHING
  RETURNING id
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- Retention: read notifications older than p_read_days, done jobs older than p_done_days.
CREATE OR REPLACE FUNCTION jobs_cleanup(p_read_days int, p_done_days int)
RETURNS TABLE (deleted_notifications int, deleted_jobs int)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int; j int;
BEGIN
  DELETE FROM public.notifications
   WHERE read_at IS NOT NULL AND read_at < now() - make_interval(days => p_read_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.jobs
   WHERE status = 'done' AND updated_at < now() - make_interval(days => p_done_days);
  GET DIAGNOSTICS j = ROW_COUNT;
  RETURN QUERY SELECT n, j;
END
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE ALL ON FUNCTION jobs_claim(text, int, int) FROM PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE ALL ON FUNCTION jobs_finish(uuid, text) FROM PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE ALL ON FUNCTION jobs_fail(uuid, text, text, int) FROM PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE ALL ON FUNCTION jobs_enqueue_system(text, jsonb, timestamptz, text) FROM PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE ALL ON FUNCTION jobs_cleanup(int, int) FROM PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT EXECUTE ON FUNCTION jobs_claim(text, int, int) TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT EXECUTE ON FUNCTION jobs_finish(uuid, text) TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT EXECUTE ON FUNCTION jobs_fail(uuid, text, text, int) TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT EXECUTE ON FUNCTION jobs_enqueue_system(text, jsonb, timestamptz, text) TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT EXECUTE ON FUNCTION jobs_cleanup(int, int) TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON jobs, notifications, notification_deliveries FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON jobs, notifications, notification_deliveries FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0028_notifications_jobs');
END
$ariforce_migration$;
COMMIT;
