-- Provisioning helper for the app role: resolve a company id from its slug (no other columns exposed).
-- Used by `pnpm -F @ariforce/api admin:create-first --company <slug>`, which runs as ariforce_app.
CREATE OR REPLACE FUNCTION company_id_by_slug(p_slug text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM companies WHERE slug = lower(p_slug) AND deleted_at IS NULL LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION company_id_by_slug(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION company_id_by_slug(text) TO ariforce_app;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION company_id_by_slug(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION company_id_by_slug(text) FROM authenticated;
  END IF;
END $$;
