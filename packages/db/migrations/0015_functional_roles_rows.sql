-- GENERATED from packages/db/drizzle/0015_functional_roles_rows.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0015_functional_roles_rows') THEN
    RAISE NOTICE 'skip 0015_functional_roles_rows (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Role rows for distribution_head / accountant in every company (needs 0014 committed first).
-- No reporting line, no field/doctor data: domain permission only. Existing rows are left as edited.
INSERT INTO roles (id, company_id, key, name, rank, permissions)
SELECT gen_random_uuid(), c.id, v.key::role_key, v.name, 0, v.perms
FROM companies c
CROSS JOIN (VALUES
  ('distribution_head', 'Distribution Head', ARRAY['me:read','roles:read','territories:read','sales:read']::text[]),
  ('accountant', 'Accountant', ARRAY['me:read','roles:read','territories:read','finance:read']::text[])
) AS v(key, name, perms)
ON CONFLICT (company_id, key) DO NOTHING;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0015_functional_roles_rows');
END
$ariforce_migration$;
COMMIT;
