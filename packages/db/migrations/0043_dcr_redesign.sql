-- GENERATED from packages/db/drizzle/0043_dcr_redesign.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0043_dcr_redesign') THEN
    RAISE NOTICE 'skip 0043_dcr_redesign (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- DCR redesign (docs/DCR-REDESIGN-DESIGN.md). Additive only; re-runnable. Existing PUT /v1/dcrs keeps working.
-- dcrs: day band, non-field details (jsonb, shape validated by the API per work type), day-level
-- Work With, submitter and submit idempotency key.
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS band text;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS details jsonb;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS work_with_user_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS submit_idempotency_key text;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN
  ALTER TABLE dcrs ADD CONSTRAINT dcrs_band_ck CHECK (band IS NULL OR band IN ('hq', 'ex_hq', 'outstation'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN
  ALTER TABLE dcrs ADD CONSTRAINT dcrs_details_ck CHECK (details IS NULL OR jsonb_typeof(details) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN
  ALTER TABLE dcrs ADD CONSTRAINT dcrs_submit_key_ck CHECK (submit_idempotency_key IS NULL OR length(submit_idempotency_key) BETWEEN 1 AND 200);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX IF NOT EXISTS dcrs_submit_key_uq ON dcrs (company_id, user_id, submit_idempotency_key)
  WHERE submit_idempotency_key IS NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- One chosen SFC route per HQ involved in a field day; snapshot frozen at submit (TA/DA).
CREATE TABLE IF NOT EXISTS dcr_sfc_routes (
  id uuid PRIMARY KEY NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id),
  dcr_id uuid NOT NULL REFERENCES dcrs(id),
  hq_territory_id uuid NOT NULL REFERENCES territories(id),
  sfc_route_id uuid NOT NULL REFERENCES sfc_routes(id),
  snapshot jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  version integer DEFAULT 1 NOT NULL,
  CONSTRAINT dcr_sfc_routes_snapshot_ck CHECK (snapshot IS NULL OR jsonb_typeof(snapshot) = 'object')
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX IF NOT EXISTS dcr_sfc_routes_dcr_hq_uq ON dcr_sfc_routes (company_id, dcr_id, hq_territory_id)
  WHERE deleted_at IS NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS dcr_sfc_routes_route_idx ON dcr_sfc_routes (company_id, sfc_route_id);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE dcr_sfc_routes ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE dcr_sfc_routes FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS tenant_isolation ON dcr_sfc_routes;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY tenant_isolation ON dcr_sfc_routes TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP TRIGGER IF EXISTS dcr_sfc_routes_row_meta ON dcr_sfc_routes;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER dcr_sfc_routes_row_meta BEFORE UPDATE ON dcr_sfc_routes FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON dcr_sfc_routes TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON dcr_sfc_routes FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON dcr_sfc_routes FROM authenticated;
  END IF;
END $$;
-- sfc_routes.category: no DB CHECK (decision 2026-10-28: the 'EX / OS' and MEETING rows stay, so a
-- validated CHECK can never pass and a NOT VALID one would block soft-deleting them). The rule
-- ex|hq|os is app-level: contract enum on the SFC PUT, importer mapping, DCR match ignores others.$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0043_dcr_redesign');
END
$ariforce_migration$;
COMMIT;
