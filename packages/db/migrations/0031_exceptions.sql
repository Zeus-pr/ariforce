-- GENERATED from packages/db/drizzle/0031_exceptions.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0031_exceptions') THEN
    RAISE NOTICE 'skip 0031_exceptions (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$CREATE TABLE IF NOT EXISTS "exception_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"severity" text NOT NULL,
	"threshold" numeric(10, 2),
	"action" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "exception_rules_severity_ck" CHECK ("exception_rules"."severity" in ('low','medium','high')),
	CONSTRAINT "exception_rules_action_len_ck" CHECK ("exception_rules"."action" is null or length("exception_rules"."action") <= 500)
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE IF NOT EXISTS "exceptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_code" text NOT NULL,
	"period_date" date NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"value" numeric(12, 2),
	"threshold" numeric(10, 2),
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assignee_id" uuid,
	"follow_up_on" date,
	"explanation" text,
	"explained_at" timestamp with time zone,
	"resolution_note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"auto_resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "exceptions_severity_ck" CHECK ("exceptions"."severity" in ('low','medium','high')),
	CONSTRAINT "exceptions_status_ck" CHECK ("exceptions"."status" in ('open','acknowledged','resolved','dismissed')),
	CONSTRAINT "exceptions_notes_len_ck" CHECK (coalesce(length("exceptions"."explanation"), 0) <= 1000 and coalesce(length("exceptions"."resolution_note"), 0) <= 1000)
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "exception_rules" ADD CONSTRAINT "exception_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX IF NOT EXISTS "exception_rules_company_code_uq" ON "exception_rules" USING btree ("company_id","code");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX IF NOT EXISTS "exceptions_dedupe_uq" ON "exceptions" USING btree ("company_id","user_id","rule_code","period_date");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS "exceptions_company_status_idx" ON "exceptions" USING btree ("company_id","status","period_date");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS "exceptions_user_period_idx" ON "exceptions" USING btree ("company_id","user_id","period_date");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE exception_rules ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE exception_rules FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS tenant_isolation ON exception_rules;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY tenant_isolation ON exception_rules TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP TRIGGER IF EXISTS exception_rules_row_meta ON exception_rules;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER exception_rules_row_meta BEFORE UPDATE ON exception_rules FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON exception_rules TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE exceptions ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE exceptions FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS tenant_isolation ON exceptions;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY tenant_isolation ON exceptions TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP TRIGGER IF EXISTS exceptions_row_meta ON exceptions;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER exceptions_row_meta BEFORE UPDATE ON exceptions FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON exceptions TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- 0030 allow-list extended with exceptions.daily (#56); body otherwise unchanged.
CREATE OR REPLACE FUNCTION jobs_enqueue_system(p_type text, p_payload jsonb, p_run_at timestamptz, p_dedupe text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid;
BEGIN
  PERFORM public.jobs_assert_runner();
  IF p_type IS NULL OR p_type <> ALL (ARRAY['maintenance.cleanup', 'exceptions.daily']) THEN
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
  EXECUTE $ariforce_stmt$-- Runner-only: one exceptions.evaluate job per live company for the window D-3..D-1 (company-local D).
CREATE OR REPLACE FUNCTION exceptions_enqueue_daily()
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
    SELECT gen_random_uuid(), c.id, 'exceptions.evaluate',
           jsonb_build_object('from', to_char(c.d - 3, 'YYYY-MM-DD'), 'to', to_char(c.d - 1, 'YYYY-MM-DD'),
                              'notify', true, 'runDate', to_char(c.d, 'YYYY-MM-DD')),
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
  EXECUTE $ariforce_stmt$REVOKE ALL ON FUNCTION exceptions_enqueue_daily() FROM PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT EXECUTE ON FUNCTION jobs_enqueue_system(text, jsonb, timestamptz, text) TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT EXECUTE ON FUNCTION exceptions_enqueue_daily() TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON exception_rules, exceptions FROM anon;
    REVOKE ALL ON FUNCTION jobs_enqueue_system(text, jsonb, timestamptz, text), exceptions_enqueue_daily() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON exception_rules, exceptions FROM authenticated;
    REVOKE ALL ON FUNCTION jobs_enqueue_system(text, jsonb, timestamptz, text), exceptions_enqueue_daily() FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0031_exceptions');
END
$ariforce_migration$;
COMMIT;
