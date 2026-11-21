-- GENERATED from packages/db/drizzle/0084_sales_target_brand.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0084_sales_target_brand') THEN
    RAISE NOTICE 'skip 0084_sales_target_brand (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$ALTER TABLE "sales_targets" ADD COLUMN IF NOT EXISTS "brand" text;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "sales_targets" DROP CONSTRAINT IF EXISTS "sales_targets_brand_ck";$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_brand_ck" CHECK ("brand" is null or length(btrim("brand")) between 1 and 120);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP INDEX IF EXISTS "sales_targets_uq";$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "sales_targets_uq" ON "sales_targets" USING btree ("company_id","territory_id","month","kind",coalesce("product_id", '00000000-0000-0000-0000-000000000000'::uuid), coalesce(lower("brand"), ''));$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE OR REPLACE VIEW kpi_sales_month WITH (security_invoker = true) AS
WITH a AS (
  SELECT company_id, territory_id, month, kind,
    sum(CASE WHEN is_return THEN -value ELSE value END) AS actual_value
  FROM sales_actuals WHERE deleted_at IS NULL GROUP BY 1, 2, 3, 4
), t AS (
  SELECT company_id, territory_id, month, kind, sum(value) AS target_value
  FROM sales_targets WHERE deleted_at IS NULL AND product_id IS NULL AND brand IS NULL GROUP BY 1, 2, 3, 4
), k AS (
  SELECT company_id, territory_id, month, kind FROM a UNION SELECT company_id, territory_id, month, kind FROM t
)
SELECT k.company_id, k.territory_id, k.month, k.kind,
  coalesce(a.actual_value, 0) AS actual_value,
  t.target_value,
  round(100.0 * coalesce(a.actual_value, 0) / nullif(t.target_value, 0), 1) AS achievement_pct,
  ly.actual_value AS ly_value,
  round(100.0 * (coalesce(a.actual_value, 0) - ly.actual_value) / nullif(ly.actual_value, 0), 1) AS growth_pct
FROM k
LEFT JOIN a ON a.territory_id = k.territory_id AND a.month = k.month AND a.kind = k.kind
LEFT JOIN t ON t.territory_id = k.territory_id AND t.month = k.month AND t.kind = k.kind
LEFT JOIN a ly ON ly.territory_id = k.territory_id AND ly.kind = k.kind
  AND ly.month = (k.month - interval '1 year')::date;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0084_sales_target_brand');
END
$ariforce_migration$;
COMMIT;
