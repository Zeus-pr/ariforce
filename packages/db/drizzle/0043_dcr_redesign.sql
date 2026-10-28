-- DCR redesign (docs/DCR-REDESIGN-DESIGN.md). Additive only; re-runnable. Existing PUT /v1/dcrs keeps working.
-- dcrs: day band, non-field details (jsonb, shape validated by the API per work type), day-level
-- Work With, submitter and submit idempotency key.
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS band text;
--> statement-breakpoint
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS details jsonb;
--> statement-breakpoint
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS work_with_user_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL;
--> statement-breakpoint
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS submit_idempotency_key text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE dcrs ADD CONSTRAINT dcrs_band_ck CHECK (band IS NULL OR band IN ('hq', 'ex_hq', 'outstation'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE dcrs ADD CONSTRAINT dcrs_details_ck CHECK (details IS NULL OR jsonb_typeof(details) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE dcrs ADD CONSTRAINT dcrs_submit_key_ck CHECK (submit_idempotency_key IS NULL OR length(submit_idempotency_key) BETWEEN 1 AND 200);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS dcrs_submit_key_uq ON dcrs (company_id, user_id, submit_idempotency_key)
  WHERE submit_idempotency_key IS NOT NULL;
--> statement-breakpoint
-- One chosen SFC route per HQ involved in a field day; snapshot frozen at submit (TA/DA).
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
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS dcr_sfc_routes_dcr_hq_uq ON dcr_sfc_routes (company_id, dcr_id, hq_territory_id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS dcr_sfc_routes_route_idx ON dcr_sfc_routes (company_id, sfc_route_id);
--> statement-breakpoint
ALTER TABLE dcr_sfc_routes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dcr_sfc_routes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON dcr_sfc_routes;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON dcr_sfc_routes TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
DROP TRIGGER IF EXISTS dcr_sfc_routes_row_meta ON dcr_sfc_routes;
--> statement-breakpoint
CREATE TRIGGER dcr_sfc_routes_row_meta BEFORE UPDATE ON dcr_sfc_routes FOR EACH ROW EXECUTE FUNCTION set_row_meta();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON dcr_sfc_routes TO ariforce_app;
--> statement-breakpoint
DO $$
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
-- ex|hq|os is app-level: contract enum on the SFC PUT, importer mapping, DCR match ignores others.
