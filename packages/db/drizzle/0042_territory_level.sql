-- Territory = a unit under an HQ (docs/TERRITORY-MODEL.md). Additive only; nothing is moved or deleted.
-- New level 'territory' (last in enum order, so it is lower than 'headquarter'); the value is not
-- used in this transaction (Postgres forbids that), so the index predicate uses territory_key only.
-- doctors/chemists/stockists.territory_id keeps meaning "HQ"; the new local_territory_id is the
-- territory under that HQ. Free-text source columns doctors/chemists.city are raw import data and
-- keep their names.
ALTER TYPE territory_level ADD VALUE IF NOT EXISTS 'territory';
--> statement-breakpoint
-- Normalised territory key: lower case, every run of non [a-z0-9] -> one space, trimmed; blank -> null.
-- Spelling variants (Bardhaman vs Burdwan) are NOT merged here; the backfill report lists them.
CREATE OR REPLACE FUNCTION ariforce_territory_key(raw text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog
  AS $fn$ SELECT nullif(btrim(regexp_replace(lower(coalesce(raw, '')), '[^a-z0-9]+', ' ', 'g')), '') $fn$;
--> statement-breakpoint
ALTER TABLE territories ADD COLUMN IF NOT EXISTS territory_key text;
--> statement-breakpoint
-- Business key: one live territory per company + HQ (parent) + normalised name.
CREATE UNIQUE INDEX IF NOT EXISTS territories_hq_territory_key_uq ON territories (company_id, parent_id, territory_key)
  WHERE territory_key IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS local_territory_id uuid REFERENCES territories(id);
--> statement-breakpoint
ALTER TABLE chemists ADD COLUMN IF NOT EXISTS local_territory_id uuid REFERENCES territories(id);
--> statement-breakpoint
ALTER TABLE stockists ADD COLUMN IF NOT EXISTS local_territory_id uuid REFERENCES territories(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS doctors_local_territory_idx ON doctors (company_id, local_territory_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chemists_local_territory_idx ON chemists (company_id, local_territory_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stockists_local_territory_idx ON stockists (company_id, local_territory_id);
