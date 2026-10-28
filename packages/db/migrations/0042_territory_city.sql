-- GENERATED from packages/db/drizzle/0042_territory_city.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0042_territory_city') THEN
    RAISE NOTICE 'skip 0042_territory_city (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Territory = city under an HQ (docs/TERRITORY-MODEL.md). Additive only; nothing is moved or deleted.
-- New level 'territory' (last in enum order, so it is lower than 'headquarter'); the value is not
-- used in this transaction (Postgres forbids that), so the index predicate compares city_key only.
ALTER TYPE territory_level ADD VALUE IF NOT EXISTS 'territory';$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- Normalised city key: lower case, every run of non [a-z0-9] -> one space, trimmed; blank -> null.
-- Spelling variants (Bardhaman vs Burdwan) are NOT merged here; the backfill report lists them.
CREATE OR REPLACE FUNCTION ariforce_city_key(raw text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog
  AS $fn$ SELECT nullif(btrim(regexp_replace(lower(coalesce(raw, '')), '[^a-z0-9]+', ' ', 'g')), '') $fn$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE territories ADD COLUMN IF NOT EXISTS city_key text;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- Business key: one live territory per company + HQ (parent) + normalised city.
CREATE UNIQUE INDEX IF NOT EXISTS territories_hq_city_uq ON territories (company_id, parent_id, city_key)
  WHERE city_key IS NOT NULL AND deleted_at IS NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- doctors/chemists.territory_id keeps meaning "HQ" (scope, KPIs, SFC unchanged); the city is extra.
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS city_territory_id uuid REFERENCES territories(id);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE chemists ADD COLUMN IF NOT EXISTS city_territory_id uuid REFERENCES territories(id);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS doctors_city_territory_idx ON doctors (company_id, city_territory_id);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS chemists_city_territory_idx ON chemists (company_id, city_territory_id);$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0042_territory_city');
END
$ariforce_migration$;
COMMIT;
