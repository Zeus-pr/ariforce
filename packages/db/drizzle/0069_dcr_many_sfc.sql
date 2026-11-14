-- A section can keep more than one SFC route, including two routes from the same HQ.
DROP INDEX IF EXISTS dcr_sfc_routes_dcr_section_hq_uq;
CREATE UNIQUE INDEX IF NOT EXISTS dcr_sfc_routes_dcr_section_route_uq
  ON dcr_sfc_routes (company_id, dcr_id, section_index, sfc_route_id)
  WHERE deleted_at IS NULL;
