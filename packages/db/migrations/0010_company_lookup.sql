-- GENERATED from packages/db/drizzle/0010_company_lookup.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0010_company_lookup') THEN
    RAISE NOTICE 'skip 0010_company_lookup (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Provisioning helper for the app role: resolve a company id from its slug (no other columns exposed).
-- Used by `pnpm -F @ariforce/api admin:create-first --company <slug>`, which runs as ariforce_app.
CREATE OR REPLACE FUNCTION company_id_by_slug(p_slug text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM companies WHERE slug = lower(p_slug) AND deleted_at IS NULL LIMIT 1
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE ALL ON FUNCTION company_id_by_slug(text) FROM PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT EXECUTE ON FUNCTION company_id_by_slug(text) TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION company_id_by_slug(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION company_id_by_slug(text) FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0010_company_lookup');
END
$ariforce_migration$;
COMMIT;
