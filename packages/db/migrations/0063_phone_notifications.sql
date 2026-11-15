-- GENERATED from packages/db/drizzle/0063_phone_notifications.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0063_phone_notifications') THEN
    RAISE NOTICE 'skip 0063_phone_notifications (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Phone push token on the enrolled device, and a daily doctor-occasion fan-out.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS push_token text;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX IF NOT EXISTS devices_push_token_uq ON devices (push_token) WHERE push_token IS NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- 0031 allow-list extended with doctors.occasions; body otherwise unchanged.
CREATE OR REPLACE FUNCTION jobs_enqueue_system(p_type text, p_payload jsonb, p_run_at timestamptz, p_dedupe text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid;
BEGIN
  PERFORM public.jobs_assert_runner();
  IF p_type IS NULL OR p_type <> ALL (ARRAY['maintenance.cleanup', 'exceptions.daily', 'doctors.occasions']) THEN
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
  EXECUTE $ariforce_stmt$-- One doctors.occasions.company job per live company for today's company-local date.
CREATE OR REPLACE FUNCTION doctors_occasions_enqueue()
RETURNS int
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  PERFORM public.jobs_assert_runner();
  WITH c AS (
    SELECT id, (now() AT TIME ZONE coalesce(nullif(timezone, ''), 'Asia/Kolkata'))::date AS d
    FROM public.companies WHERE deleted_at IS NULL
  ), ins AS (
    INSERT INTO public.jobs (id, company_id, type, payload, run_at, dedupe_key)
    SELECT gen_random_uuid(), c.id, 'doctors.occasions.company',
           jsonb_build_object('runDate', to_char(c.d, 'YYYY-MM-DD')),
           now(), c.id::text || ':' || to_char(c.d, 'YYYY-MM-DD')
    FROM c
    ON CONFLICT (type, dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO n FROM ins;
  RETURN n;
END
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE ALL ON FUNCTION jobs_enqueue_system(text, jsonb, timestamptz, text) FROM PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE ALL ON FUNCTION doctors_occasions_enqueue() FROM PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT EXECUTE ON FUNCTION jobs_enqueue_system(text, jsonb, timestamptz, text) TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT EXECUTE ON FUNCTION doctors_occasions_enqueue() TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION jobs_enqueue_system(text, jsonb, timestamptz, text), doctors_occasions_enqueue() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION jobs_enqueue_system(text, jsonb, timestamptz, text), doctors_occasions_enqueue() FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0063_phone_notifications');
END
$ariforce_migration$;
COMMIT;
