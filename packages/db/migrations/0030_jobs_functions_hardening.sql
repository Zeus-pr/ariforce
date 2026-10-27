-- GENERATED from packages/db/drizzle/0030_jobs_functions_hardening.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0030_jobs_functions_hardening') THEN
    RAISE NOTICE 'skip 0030_jobs_functions_hardening (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Harden the 0028 jobs_* SECURITY DEFINER functions (threat model: docs/NOTIFICATIONS.md).
-- 0028 is applied live and is not edited. Idempotent: CREATE OR REPLACE / DROP IF EXISTS + re-grant.
-- * runner-only functions (claim, cleanup, enqueue_system) refuse to run inside a tenant transaction
-- * jobs_claim hands out an unguessable per-job lock token; finish/fail need that exact token and,
--   inside a tenant transaction, a job of that tenant
-- * jobs_enqueue_system only accepts known system job types and small payloads
-- * jobs_cleanup has retention floors (30 days read notifications, 1 day done jobs) and a batch cap
CREATE OR REPLACE FUNCTION jobs_assert_runner()
RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(current_setting('app.current_company_id', true), '') <> '' THEN
    RAISE EXCEPTION 'jobs: runner-only function called inside a tenant transaction'
      USING ERRCODE = '42501';
  END IF;
END
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE ALL ON FUNCTION jobs_assert_runner() FROM PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT EXECUTE ON FUNCTION jobs_assert_runner() TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- The return type gains job_lock_token, so the function is dropped and re-created (grants re-applied below).
DROP FUNCTION IF EXISTS jobs_claim(text, int, int);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE FUNCTION jobs_claim(p_worker text, p_limit int, p_lock_timeout_s int)
RETURNS TABLE (job_id uuid, job_company_id uuid, job_type text, job_payload jsonb, job_attempts int, job_max_attempts int, job_lock_token text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.jobs_assert_runner();
  RETURN QUERY
  UPDATE public.jobs j
     SET status = 'running', locked_at = now(),
         locked_by = left(coalesce(p_worker, 'worker'), 100) || '/' || gen_random_uuid()::text,
         attempts = j.attempts + 1, updated_at = now()
   WHERE j.id IN (
     SELECT c.id FROM public.jobs c
      WHERE (c.status = 'queued' AND c.run_at <= now())
         OR (c.status = 'running'
             AND c.locked_at < now() - make_interval(secs => greatest(coalesce(p_lock_timeout_s, 300), 30)))
      ORDER BY c.run_at, c.id
      LIMIT greatest(least(coalesce(p_limit, 10), 100), 1)
      FOR UPDATE SKIP LOCKED)
  RETURNING j.id, j.company_id, j.type, j.payload, j.attempts, j.max_attempts, j.locked_by;
END
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- p_worker is now the lock token returned by jobs_claim (name kept for CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION jobs_finish(p_id uuid, p_worker text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS (
    UPDATE public.jobs SET status = 'done', locked_at = NULL, last_error = NULL, updated_at = now()
     WHERE id = p_id AND p_worker IS NOT NULL AND locked_by = p_worker AND status = 'running'
       AND company_id IS NOT DISTINCT FROM coalesce(nullif(current_setting('app.current_company_id', true), '')::uuid, company_id)
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u)
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE OR REPLACE FUNCTION jobs_fail(p_id uuid, p_worker text, p_error text, p_retry_s int)
RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.jobs
     SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
         run_at = CASE WHEN attempts >= max_attempts THEN run_at
                       ELSE now() + make_interval(secs => least(greatest(coalesce(p_retry_s, 30), 0), 86400)) END,
         locked_at = NULL, locked_by = NULL, last_error = left(p_error, 500), updated_at = now()
   WHERE id = p_id AND p_worker IS NOT NULL AND locked_by = p_worker AND status = 'running'
     AND company_id IS NOT DISTINCT FROM coalesce(nullif(current_setting('app.current_company_id', true), '')::uuid, company_id)
  RETURNING status
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE OR REPLACE FUNCTION jobs_enqueue_system(p_type text, p_payload jsonb, p_run_at timestamptz, p_dedupe text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid;
BEGIN
  PERFORM public.jobs_assert_runner();
  IF p_type IS NULL OR p_type <> ALL (ARRAY['maintenance.cleanup']) THEN
    RAISE EXCEPTION 'jobs: unknown system job type %', p_type USING ERRCODE = '22023';
  END IF;
  IF octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 4096 THEN
    RAISE EXCEPTION 'jobs: system job payload too large' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.jobs (id, company_id, type, payload, run_at, dedupe_key)
  VALUES (gen_random_uuid(), NULL, p_type, coalesce(p_payload, '{}'::jsonb),
          least(coalesce(p_run_at, now()), now() + interval '7 days'), left(p_dedupe, 200))
  ON CONFLICT (type, dedupe_key) DO NOTHING
  RETURNING id INTO v;
  RETURN v;
END
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- Floors win over arguments: read notifications >= 30 days, done jobs >= 1 day. At most 50k rows
-- per table per call (the daily job catches up over following days).
CREATE OR REPLACE FUNCTION jobs_cleanup(p_read_days int, p_done_days int)
RETURNS TABLE (deleted_notifications int, deleted_jobs int)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int; j int;
  rd int := greatest(coalesce(p_read_days, 90), 30);
  dd int := greatest(coalesce(p_done_days, 14), 1);
BEGIN
  PERFORM public.jobs_assert_runner();
  DELETE FROM public.notifications WHERE id IN (
    SELECT id FROM public.notifications
     WHERE read_at IS NOT NULL AND read_at < now() - make_interval(days => rd) LIMIT 50000);
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.jobs WHERE id IN (
    SELECT id FROM public.jobs
     WHERE status = 'done' AND updated_at < now() - make_interval(days => dd) LIMIT 50000);
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
    REVOKE ALL ON FUNCTION jobs_claim(text, int, int), jobs_finish(uuid, text), jobs_fail(uuid, text, text, int),
      jobs_enqueue_system(text, jsonb, timestamptz, text), jobs_cleanup(int, int), jobs_assert_runner() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION jobs_claim(text, int, int), jobs_finish(uuid, text), jobs_fail(uuid, text, text, int),
      jobs_enqueue_system(text, jsonb, timestamptz, text), jobs_cleanup(int, int), jobs_assert_runner() FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0030_jobs_functions_hardening');
END
$ariforce_migration$;
COMMIT;
