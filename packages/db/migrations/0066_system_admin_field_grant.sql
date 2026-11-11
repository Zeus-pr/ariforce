-- GENERATED from packages/db/drizzle/0066_system_admin_field_grant.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0066_system_admin_field_grant') THEN
    RAISE NOTICE 'skip 0066_system_admin_field_grant (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- System Admin may view and edit outlet GPS locks (field:read, field:write).
-- 0061 was meant to set the full role list including these two. This only adds them
-- when they are missing, and leaves every other permission on the role as it is.
UPDATE roles
SET permissions = (
  SELECT coalesce(array_agg(x ORDER BY x), '{}')
  FROM (
    SELECT DISTINCT unnest(
      permissions || ARRAY['field:read', 'field:write']::text[]
    ) AS x
  ) s
)
WHERE key::text = 'system_admin'
  AND deleted_at IS NULL
  AND NOT (
    permissions @> ARRAY['field:read']::text[]
    AND permissions @> ARRAY['field:write']::text[]
  );$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0066_system_admin_field_grant');
END
$ariforce_migration$;
COMMIT;
