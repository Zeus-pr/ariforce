-- GENERATED from packages/db/drizzle/0048_dcr_pob_review.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0048_dcr_pob_review') THEN
    RAISE NOTICE 'skip 0048_dcr_pob_review (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- DCR manager review + doctor presentation (0048). Additive only; RLS, triggers, indexes and the
-- KPI views are unchanged:
-- * doc_status already has 'rejected'. dcrs_user_date_submitted_uq stays WHERE status IN
--   ('submitted','approved'), so a rejected report is outside it and the day can be filed again.
-- * kpi_user_day / dcr_day_calls (0046) already count only submitted/approved, so rejected reports
--   drop out of KPIs, missed-DCR flags and exceptions without a view change; the POB views sum the
--   stored dcr_call_products.value (priced by the API at save time, now at PTS), so no view reads
--   products.ptr.
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS approved_at timestamptz;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS rejected_at timestamptz;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES users(id);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS rejection_reason text;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE dcrs DROP CONSTRAINT IF EXISTS dcrs_rejected_ck;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE dcrs ADD CONSTRAINT dcrs_rejected_ck CHECK (status <> 'rejected' OR (rejected_at IS NOT NULL AND rejected_by IS NOT NULL AND length(rejection_reason) BETWEEN 1 AND 500));$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE dcr_calls ADD COLUMN IF NOT EXISTS presentation_opened_at timestamptz;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0048_dcr_pob_review');
END
$ariforce_migration$;
COMMIT;
