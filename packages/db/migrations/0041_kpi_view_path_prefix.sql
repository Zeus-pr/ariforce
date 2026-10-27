-- GENERATED from packages/db/drizzle/0041_kpi_view_path_prefix.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0041_kpi_view_path_prefix') THEN
    RAISE NOTICE 'skip 0041_kpi_view_path_prefix (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Territory subtree test in kpi_user_doctor_list: starts_with instead of LIKE. Real territory paths
-- are code-based (e.g. WB.HQ_MALDA) and '_' / '%' are LIKE wildcards, so `LIKE path || '.%'` could
-- match a sibling subtree (HQ_MALDA would match HQxMALDA.*). Same columns; view is replaced in place.
CREATE OR REPLACE VIEW kpi_user_doctor_list WITH (security_invoker = true) AS
SELECT DISTINCT ON (ut.user_id, d.id)
  d.company_id, ut.user_id, d.id AS doctor_id, d.territory_id, d.category_id,
  coalesce(d.visits_per_cycle_override, dc.visits_per_cycle, 1) AS required_visits
FROM user_territories ut
JOIN territories ut_t ON ut_t.id = ut.territory_id AND ut_t.deleted_at IS NULL
JOIN territories dt ON dt.company_id = ut_t.company_id
  AND (dt.path = ut_t.path OR starts_with(dt.path, ut_t.path || '.')) AND dt.deleted_at IS NULL
JOIN doctors d ON d.territory_id = dt.id AND d.deleted_at IS NULL AND d.approval_status = 'approved'
LEFT JOIN doctor_categories dc ON dc.id = d.category_id;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0041_kpi_view_path_prefix');
END
$ariforce_migration$;
COMMIT;
