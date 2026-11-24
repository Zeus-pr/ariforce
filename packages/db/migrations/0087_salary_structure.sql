-- GENERATED from packages/db/drizzle/0087_salary_structure.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0087_salary_structure') THEN
    RAISE NOTICE 'skip 0087_salary_structure (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$CREATE TABLE IF NOT EXISTS salary_structures (
  "id" uuid PRIMARY KEY NOT NULL,
  "company_id" uuid NOT NULL REFERENCES companies(id),
  "user_id" uuid NOT NULL REFERENCES users(id),
  "effective_month" date NOT NULL,
  "basic_monthly" integer NOT NULL,
  "hra_monthly" integer NOT NULL,
  "special_monthly" integer NOT NULL,
  "professional_tax_monthly" integer DEFAULT 0 NOT NULL,
  "bonus_deduction_monthly" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT salary_structures_month_ck CHECK (extract(day from effective_month) = 1),
  CONSTRAINT salary_structures_amounts_ck CHECK (basic_monthly >= 0 AND hra_monthly >= 0 AND special_monthly >= 0 AND professional_tax_monthly >= 0 AND bonus_deduction_monthly >= 0)
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX IF NOT EXISTS salary_structures_user_month_uq ON salary_structures (company_id, user_id, effective_month) WHERE deleted_at IS NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE salary_structures ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE salary_structures FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS tenant_isolation ON salary_structures;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY tenant_isolation ON salary_structures TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP TRIGGER IF EXISTS salary_structures_row_meta ON salary_structures;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER salary_structures_row_meta BEFORE UPDATE ON salary_structures FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON salary_structures TO ariforce_app;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0087_salary_structure');
END
$ariforce_migration$;
COMMIT;
