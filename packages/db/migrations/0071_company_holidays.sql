-- GENERATED from packages/db/drizzle/0071_company_holidays.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0071_company_holidays') THEN
    RAISE NOTICE 'skip 0071_company_holidays (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Company holiday labels. A date stays a working day: punch-in, DCR and tour plans are unchanged.
CREATE TABLE IF NOT EXISTS company_holidays (
  "id" uuid PRIMARY KEY NOT NULL,
  "company_id" uuid NOT NULL REFERENCES companies(id),
  "date" date NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT company_holidays_name_ck CHECK (char_length(btrim(name)) BETWEEN 1 AND 80)
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX IF NOT EXISTS company_holidays_date_uq ON company_holidays (company_id, date) WHERE deleted_at IS NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS company_holidays_year_idx ON company_holidays (company_id, date);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE company_holidays ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE company_holidays FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS tenant_isolation ON company_holidays;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY tenant_isolation ON company_holidays TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP TRIGGER IF EXISTS company_holidays_row_meta ON company_holidays;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER company_holidays_row_meta BEFORE UPDATE ON company_holidays FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON company_holidays TO ariforce_app;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0071_company_holidays');
END
$ariforce_migration$;
COMMIT;
