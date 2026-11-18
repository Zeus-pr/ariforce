-- GENERATED from packages/db/drizzle/0078_hr_role.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0078_hr_role') THEN
    RAISE NOTICE 'skip 0078_hr_role (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- One HR role row per company. No field work and no reporting line. Existing rows are left as edited.
INSERT INTO roles (id, company_id, key, name, rank, permissions)
SELECT gen_random_uuid(), c.id, 'hr'::role_key, 'HR', 0,
  ARRAY['me:read','roles:read','territories:read','users:read','users:write']::text[]
FROM companies c
ON CONFLICT (company_id, key) DO NOTHING;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0078_hr_role');
END
$ariforce_migration$;
COMMIT;
