-- GENERATED from packages/db/drizzle/0047_product_image.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0047_product_image') THEN
    RAISE NOTICE 'skip 0047_product_image (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Product picture (POST /v1/files/upload-url purpose product_image, attached via
-- PUT /v1/products/{id}/image). Holds the R2 key only (`<companyId>/product_image/...`), same
-- pattern as expense_attachments.file_key / attendance selfie_file_key. Nullable, additive; RLS and
-- the products_row_meta trigger (updated_at/version) are unchanged.
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_file_key text;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0047_product_image');
END
$ariforce_migration$;
COMMIT;
