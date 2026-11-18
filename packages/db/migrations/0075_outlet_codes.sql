-- GENERATED from packages/db/drizzle/0075_outlet_codes.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0075_outlet_codes') THEN
    RAISE NOTICE 'skip 0075_outlet_codes (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Arighna codes for doctors, chemists and stockists. No place name. Assigned once.
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE chemists ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE stockists ADD COLUMN IF NOT EXISTS code text;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY company_id ORDER BY created_at, id) AS n
  FROM doctors
)
UPDATE doctors d
SET code = 'ARIDOC' || lpad(numbered.n::text, 6, '0')
FROM numbered
WHERE d.id = numbered.id AND d.code IS NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY company_id ORDER BY created_at, id) AS n
  FROM chemists
)
UPDATE chemists c
SET code = 'ARICHM' || lpad(numbered.n::text, 6, '0')
FROM numbered
WHERE c.id = numbered.id AND c.code IS NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY company_id ORDER BY created_at, id) AS n
  FROM stockists
)
UPDATE stockists s
SET code = 'ARISTK' || lpad(numbered.n::text, 6, '0')
FROM numbered
WHERE s.id = numbered.id AND s.code IS NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE doctors ALTER COLUMN code SET NOT NULL;
ALTER TABLE chemists ALTER COLUMN code SET NOT NULL;
ALTER TABLE stockists ALTER COLUMN code SET NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX IF NOT EXISTS doctors_code_uq ON doctors (company_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS chemists_code_uq ON chemists (company_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS stockists_code_uq ON stockists (company_id, code);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE OR REPLACE FUNCTION assign_outlet_code() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prefix text;
  n int;
BEGIN
  IF NEW.code IS NOT NULL AND btrim(NEW.code) <> '' THEN
    RETURN NEW;
  END IF;
  prefix := CASE TG_TABLE_NAME
    WHEN 'doctors' THEN 'ARIDOC'
    WHEN 'chemists' THEN 'ARICHM'
    ELSE 'ARISTK'
  END;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.company_id::text), hashtext(TG_TABLE_NAME));
  EXECUTE format(
    'SELECT COALESCE(MAX(substring(code from 7)::int), 0) FROM %I WHERE company_id = $1 AND code ~ $2',
    TG_TABLE_NAME
  ) INTO n USING NEW.company_id, '^' || prefix || '[0-9]{6}$';
  NEW.code := prefix || lpad((n + 1)::text, 6, '0');
  RETURN NEW;
END;
$$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP TRIGGER IF EXISTS doctors_assign_code ON doctors;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER doctors_assign_code BEFORE INSERT ON doctors
  FOR EACH ROW EXECUTE FUNCTION assign_outlet_code();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP TRIGGER IF EXISTS chemists_assign_code ON chemists;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER chemists_assign_code BEFORE INSERT ON chemists
  FOR EACH ROW EXECUTE FUNCTION assign_outlet_code();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP TRIGGER IF EXISTS stockists_assign_code ON stockists;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER stockists_assign_code BEFORE INSERT ON stockists
  FOR EACH ROW EXECUTE FUNCTION assign_outlet_code();$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0075_outlet_codes');
END
$ariforce_migration$;
COMMIT;
