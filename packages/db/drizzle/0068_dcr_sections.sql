-- One DCR day holds more than one section. Header columns stay section 0.
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS sections jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE dcr_calls ADD COLUMN IF NOT EXISTS section_index integer NOT NULL DEFAULT 0;
ALTER TABLE dcr_sfc_routes ADD COLUMN IF NOT EXISTS section_index integer NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS dcr_sfc_routes_dcr_hq_uq;
CREATE UNIQUE INDEX IF NOT EXISTS dcr_sfc_routes_dcr_section_hq_uq
  ON dcr_sfc_routes (company_id, dcr_id, section_index, hq_territory_id)
  WHERE deleted_at IS NULL;
