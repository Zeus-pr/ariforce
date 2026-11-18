-- Arighna codes for doctors, chemists and stockists. No place name. Assigned once.
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE chemists ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE stockists ADD COLUMN IF NOT EXISTS code text;
--> statement-breakpoint
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY company_id ORDER BY created_at, id) AS n
  FROM doctors
)
UPDATE doctors d
SET code = 'ARIDOC' || lpad(numbered.n::text, 6, '0')
FROM numbered
WHERE d.id = numbered.id AND d.code IS NULL;
--> statement-breakpoint
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY company_id ORDER BY created_at, id) AS n
  FROM chemists
)
UPDATE chemists c
SET code = 'ARICHM' || lpad(numbered.n::text, 6, '0')
FROM numbered
WHERE c.id = numbered.id AND c.code IS NULL;
--> statement-breakpoint
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY company_id ORDER BY created_at, id) AS n
  FROM stockists
)
UPDATE stockists s
SET code = 'ARISTK' || lpad(numbered.n::text, 6, '0')
FROM numbered
WHERE s.id = numbered.id AND s.code IS NULL;
--> statement-breakpoint
ALTER TABLE doctors ALTER COLUMN code SET NOT NULL;
ALTER TABLE chemists ALTER COLUMN code SET NOT NULL;
ALTER TABLE stockists ALTER COLUMN code SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS doctors_code_uq ON doctors (company_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS chemists_code_uq ON chemists (company_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS stockists_code_uq ON stockists (company_id, code);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assign_outlet_code() RETURNS trigger
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
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS doctors_assign_code ON doctors;
--> statement-breakpoint
CREATE TRIGGER doctors_assign_code BEFORE INSERT ON doctors
  FOR EACH ROW EXECUTE FUNCTION assign_outlet_code();
--> statement-breakpoint
DROP TRIGGER IF EXISTS chemists_assign_code ON chemists;
--> statement-breakpoint
CREATE TRIGGER chemists_assign_code BEFORE INSERT ON chemists
  FOR EACH ROW EXECUTE FUNCTION assign_outlet_code();
--> statement-breakpoint
DROP TRIGGER IF EXISTS stockists_assign_code ON stockists;
--> statement-breakpoint
CREATE TRIGGER stockists_assign_code BEFORE INSERT ON stockists
  FOR EACH ROW EXECUTE FUNCTION assign_outlet_code();
