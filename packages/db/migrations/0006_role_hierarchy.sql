-- GENERATED from packages/db/drizzle/0006_role_hierarchy.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0006_role_hierarchy') THEN
    RAISE NOTICE 'skip 0006_role_hierarchy (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Role hierarchy v2 (Prajesh, 2026-10-27): 8 sales levels + a technical system_admin.
-- Renames keep enum positions, existing roles/user_roles/approval_steps rows and their ids.
--   rep -> business_manager (1), area_manager -> area_business_manager (2),
--   regional_manager -> regional_business_manager (3), zonal_manager -> zonal_business_manager (4),
--   national_head -> director (8), admin -> system_admin (0, outside the hierarchy).
-- New levels sales_manager (5), general_manager (6), vice_president (7) are added before director.
-- Each step is guarded so the file is safe on a database where some values were already changed.
-- New enum values cannot be used in the same transaction, so this file only renames/adds and
-- updates rows that use renamed values; seeds insert rows for the three new roles.
DO $$
DECLARE
  pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['rep', 'business_manager'],
    ['area_manager', 'area_business_manager'],
    ['regional_manager', 'regional_business_manager'],
    ['zonal_manager', 'zonal_business_manager'],
    ['national_head', 'director'],
    ['admin', 'system_admin']
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'role_key' AND t.typnamespace = 'public'::regnamespace AND e.enumlabel = pair[1]
    ) THEN
      EXECUTE format('ALTER TYPE public.role_key RENAME VALUE %L TO %L', pair[1], pair[2]);
    END IF;
  END LOOP;
END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TYPE public.role_key ADD VALUE IF NOT EXISTS 'sales_manager' BEFORE 'director';$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TYPE public.role_key ADD VALUE IF NOT EXISTS 'general_manager' BEFORE 'director';$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TYPE public.role_key ADD VALUE IF NOT EXISTS 'vice_president' BEFORE 'director';$ariforce_stmt$;
  EXECUTE $ariforce_stmt$UPDATE public.roles SET
  rank = CASE key::text
    WHEN 'business_manager' THEN 1 WHEN 'area_business_manager' THEN 2
    WHEN 'regional_business_manager' THEN 3 WHEN 'zonal_business_manager' THEN 4
    WHEN 'director' THEN 8 WHEN 'system_admin' THEN 0 ELSE rank END,
  name = CASE key::text
    WHEN 'business_manager' THEN 'Business Manager' WHEN 'area_business_manager' THEN 'Area Business Manager'
    WHEN 'regional_business_manager' THEN 'Regional Business Manager'
    WHEN 'zonal_business_manager' THEN 'Zonal Business Manager'
    WHEN 'director' THEN 'Director' WHEN 'system_admin' THEN 'System Admin' ELSE name END,
  updated_at = now(),
  version = version + 1
WHERE key::text IN ('business_manager', 'area_business_manager', 'regional_business_manager',
  'zonal_business_manager', 'director', 'system_admin');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- system_admin is technical: no field data unless explicitly granted later.
UPDATE public.roles SET
  permissions = ARRAY(SELECT unnest(permissions) EXCEPT SELECT unnest(ARRAY['field:read', 'field:write', 'approvals:decide', 'reports:read'])),
  updated_at = now(),
  version = version + 1
WHERE key::text = 'system_admin';$ariforce_stmt$;
  EXECUTE $ariforce_stmt$COMMENT ON TYPE public.role_key IS
  'Sales hierarchy rank 1..8 (business_manager..director) plus system_admin (rank 0, no reporting line). See docs/RBAC.md.';$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0006_role_hierarchy');
END
$ariforce_migration$;
COMMIT;
