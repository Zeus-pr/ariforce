-- GENERATED from packages/db/drizzle/0007_import_products.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0007_import_products') THEN
    RAISE NOTICE 'skip 0007_import_products (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."import_entity" AS ENUM('doctors', 'chemists', 'stockists', 'products', 'divisions', 'product_hq', 'territories', 'users', 'sales_actuals', 'sales_targets');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."import_row_status" AS ENUM('valid', 'created', 'updated', 'duplicate', 'skipped', 'error');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."import_status" AS ENUM('validated', 'completed', 'failed');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."product_form" AS ENUM('tablet', 'capsule', 'syrup', 'injection', 'cream', 'drops', 'other');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "divisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"entity" "import_entity" NOT NULL,
	"dry_run" boolean NOT NULL,
	"status" "import_status" NOT NULL,
	"on_duplicate" text DEFAULT 'skip' NOT NULL,
	"file_name" text,
	"file_key" text,
	"idempotency_key" text,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"status" "import_row_status" NOT NULL,
	"raw" jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"entity_id" uuid,
	"duplicate_of" uuid,
	"duplicate_rule" text
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "product_hq_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"division_id" uuid NOT NULL,
	"product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"division_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"composition" text,
	"pack_size" text,
	"form" "product_form",
	"mrp" numeric(12, 2),
	"ptr" numeric(12, 2),
	"pts" numeric(12, 2),
	"is_sample" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "divisions" ADD CONSTRAINT "divisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "product_hq_mappings" ADD CONSTRAINT "product_hq_mappings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "product_hq_mappings" ADD CONSTRAINT "product_hq_mappings_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "product_hq_mappings" ADD CONSTRAINT "product_hq_mappings_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "product_hq_mappings" ADD CONSTRAINT "product_hq_mappings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "products" ADD CONSTRAINT "products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "products" ADD CONSTRAINT "products_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "divisions_company_code_uq" ON "divisions" USING btree ("company_id","code");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "import_jobs_company_idx" ON "import_jobs" USING btree ("company_id","created_at");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "import_jobs_idem_uq" ON "import_jobs" USING btree ("company_id","idempotency_key","dry_run") WHERE "import_jobs"."idempotency_key" is not null;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "import_rows_job_row_uq" ON "import_rows" USING btree ("job_id","row_no");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "product_hq_uq" ON "product_hq_mappings" USING btree ("company_id","territory_id","division_id",coalesce("product_id", '00000000-0000-0000-0000-000000000000'::uuid));$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "products_company_code_uq" ON "products" USING btree ("company_id",upper("code"));$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "products_division_idx" ON "products" USING btree ("company_id","division_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['divisions','products','product_hq_mappings','import_jobs','import_rows'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON divisions, products, product_hq_mappings TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER divisions_row_meta BEFORE UPDATE ON divisions FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER products_row_meta BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER product_hq_mappings_row_meta BEFORE UPDATE ON product_hq_mappings FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- Import jobs: insert + read, status/finished_at updated once by the importer. Rows are append-only.
GRANT SELECT, INSERT, UPDATE ON import_jobs TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT ON import_rows TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE UPDATE, DELETE, TRUNCATE ON import_rows FROM ariforce_app, PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER import_rows_no_update BEFORE UPDATE OR DELETE ON import_rows FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON divisions, products, product_hq_mappings, import_jobs, import_rows FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON divisions, products, product_hq_mappings, import_jobs, import_rows FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0007_import_products');
END
$ariforce_migration$;
COMMIT;
