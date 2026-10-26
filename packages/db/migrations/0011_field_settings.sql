-- GENERATED from packages/db/drizzle/0011_field_settings.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0011_field_settings') THEN
    RAISE NOTICE 'skip 0011_field_settings (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$ALTER TABLE "companies" ADD COLUMN "geofence_max_accuracy_m" integer DEFAULT 200 NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "companies" ADD COLUMN "geofence_block_out_of_fence" boolean DEFAULT false NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "companies" ADD COLUMN "geofence_block_mock" boolean DEFAULT true NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "geo_captures" ADD COLUMN "territory_id" uuid;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "geo_captures" ADD COLUMN "selfie_file_key" text;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "geo_captures_territory_idx" ON "geo_captures" USING btree ("company_id","territory_id","captured_at");$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0011_field_settings');
END
$ariforce_migration$;
COMMIT;
