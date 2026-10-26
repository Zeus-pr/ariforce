-- Masters write (doctors, chemists, stockists, products, divisions, territories, work types,
-- HQ mappings, imports) = RBM and above + system_admin. ABM/BM become read-only on masters.
-- Idempotent: set difference / union on roles.permissions, safe to re-run. Per-company edits to
-- other permissions are preserved.
UPDATE roles SET
  permissions = ARRAY(
    SELECT DISTINCT x FROM unnest(permissions) AS x
    WHERE x NOT IN ('masters:write', 'territories:write', 'imports:write') ORDER BY x
  ),
  updated_at = now()
WHERE key IN ('business_manager', 'area_business_manager')
  AND permissions && ARRAY['masters:write', 'territories:write', 'imports:write']::text[];--> statement-breakpoint
UPDATE roles SET
  permissions = ARRAY(
    SELECT DISTINCT x FROM unnest(permissions || ARRAY['masters:write', 'territories:write', 'imports:write']::text[]) AS x
    ORDER BY x
  ),
  updated_at = now()
WHERE key IN ('regional_business_manager', 'zonal_business_manager', 'sales_manager',
              'general_manager', 'vice_president', 'director', 'system_admin')
  AND NOT (permissions @> ARRAY['masters:write', 'territories:write', 'imports:write']::text[]);--> statement-breakpoint
-- Finer read permissions (accepted by lead): stockists:read, products:read for every role that
-- already reads masters; distribution_head also gets both, accountant gets products:read.
UPDATE roles SET
  permissions = ARRAY(
    SELECT DISTINCT x FROM unnest(permissions || ARRAY['stockists:read', 'products:read']::text[]) AS x
    ORDER BY x
  ),
  updated_at = now()
WHERE (permissions @> ARRAY['masters:read']::text[] OR key = 'distribution_head')
  AND NOT (permissions @> ARRAY['stockists:read', 'products:read']::text[]);--> statement-breakpoint
UPDATE roles SET
  permissions = ARRAY(
    SELECT DISTINCT x FROM unnest(permissions || ARRAY['products:read']::text[]) AS x ORDER BY x
  ),
  updated_at = now()
WHERE key = 'accountant' AND NOT (permissions @> ARRAY['products:read']::text[]);
