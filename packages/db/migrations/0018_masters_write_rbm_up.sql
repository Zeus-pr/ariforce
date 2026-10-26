-- GENERATED from packages/db/drizzle/0018_masters_write_rbm_up.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0018_masters_write_rbm_up') THEN
    RAISE NOTICE 'skip 0018_masters_write_rbm_up (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Masters write (doctors, chemists, stockists, products, divisions, territories, work types,
-- HQ mappings, imports) = RBM and above + system_admin. ABM/BM become read-only on masters.
-- Idempotent: set difference / union on roles.permissions, safe to re-run. Per-company edits to
-- other permissions are preserved.
UPDATE roles SET
  permissions = ARRAY(
    SELECT DISTINCT x FROM unnest(permissions) AS x
    WHERE x NOT IN ('masters:write', 'territories:write', 'imports:write') ORDER BY x
  ),
  updated_at = now()
WHERE key IN ('business_manager', 'area_business_manager')
  AND permissions && ARRAY['masters:write', 'territories:write', 'imports:write']::text[];$ariforce_stmt$;
  EXECUTE $ariforce_stmt$UPDATE roles SET
  permissions = ARRAY(
    SELECT DISTINCT x FROM unnest(permissions || ARRAY['masters:write', 'territories:write', 'imports:write']::text[]) AS x
    ORDER BY x
  ),
  updated_at = now()
WHERE key IN ('regional_business_manager', 'zonal_business_manager', 'sales_manager',
              'general_manager', 'vice_president', 'director', 'system_admin')
  AND NOT (permissions @> ARRAY['masters:write', 'territories:write', 'imports:write']::text[]);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- Finer read permissions (accepted by lead): stockists:read, products:read for every role that
-- already reads masters; distribution_head also gets both, accountant gets products:read.
UPDATE roles SET
  permissions = ARRAY(
    SELECT DISTINCT x FROM unnest(permissions || ARRAY['stockists:read', 'products:read']::text[]) AS x
    ORDER BY x
  ),
  updated_at = now()
WHERE (permissions @> ARRAY['masters:read']::text[] OR key = 'distribution_head')
  AND NOT (permissions @> ARRAY['stockists:read', 'products:read']::text[]);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$UPDATE roles SET
  permissions = ARRAY(
    SELECT DISTINCT x FROM unnest(permissions || ARRAY['products:read']::text[]) AS x ORDER BY x
  ),
  updated_at = now()
WHERE key = 'accountant' AND NOT (permissions @> ARRAY['products:read']::text[]);$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0018_masters_write_rbm_up');
END
$ariforce_migration$;
COMMIT;
