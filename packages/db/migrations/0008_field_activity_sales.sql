-- GENERATED from packages/db/drizzle/0008_field_activity_sales.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0008_field_activity_sales') THEN
    RAISE NOTICE 'skip 0008_field_activity_sales (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."call_line_kind" AS ENUM('detailed', 'sample', 'pob');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."doc_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."outlet_kind" AS ENUM('doctor', 'chemist', 'stockist');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TYPE "public"."sales_kind" AS ENUM('primary', 'secondary');$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "dcr_call_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" "call_line_kind" NOT NULL,
	"seq" smallint,
	"quantity" integer,
	"value" numeric(14, 2),
	"stockist_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "dcr_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"dcr_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"outlet_kind" "outlet_kind" NOT NULL,
	"outlet_id" uuid NOT NULL,
	"called_at" timestamp with time zone,
	"geo_capture_id" uuid,
	"joint_work_user_id" uuid,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "dcrs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"work_type_id" uuid NOT NULL,
	"territory_id" uuid,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"deviation_reason" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "sales_actuals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"stockist_id" uuid,
	"product_id" uuid NOT NULL,
	"month" date NOT NULL,
	"kind" "sales_kind" NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"free_quantity" integer DEFAULT 0 NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"is_return" boolean DEFAULT false NOT NULL,
	"import_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "sales_targets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"product_id" uuid,
	"month" date NOT NULL,
	"kind" "sales_kind" NOT NULL,
	"quantity" integer,
	"value" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "tour_plan_visits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"tour_plan_id" uuid NOT NULL,
	"date" date NOT NULL,
	"outlet_kind" "outlet_kind" NOT NULL,
	"outlet_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TABLE "tour_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"month" date NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tour_plans_month_first" CHECK (extract(day from "tour_plans"."month") = 1)
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcr_call_products" ADD CONSTRAINT "dcr_call_products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcr_call_products" ADD CONSTRAINT "dcr_call_products_call_id_dcr_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."dcr_calls"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcr_call_products" ADD CONSTRAINT "dcr_call_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcr_call_products" ADD CONSTRAINT "dcr_call_products_stockist_id_stockists_id_fk" FOREIGN KEY ("stockist_id") REFERENCES "public"."stockists"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcr_calls" ADD CONSTRAINT "dcr_calls_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcr_calls" ADD CONSTRAINT "dcr_calls_dcr_id_dcrs_id_fk" FOREIGN KEY ("dcr_id") REFERENCES "public"."dcrs"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcr_calls" ADD CONSTRAINT "dcr_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcr_calls" ADD CONSTRAINT "dcr_calls_geo_capture_id_geo_captures_id_fk" FOREIGN KEY ("geo_capture_id") REFERENCES "public"."geo_captures"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcr_calls" ADD CONSTRAINT "dcr_calls_joint_work_user_id_users_id_fk" FOREIGN KEY ("joint_work_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcrs" ADD CONSTRAINT "dcrs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcrs" ADD CONSTRAINT "dcrs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcrs" ADD CONSTRAINT "dcrs_work_type_id_work_types_id_fk" FOREIGN KEY ("work_type_id") REFERENCES "public"."work_types"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcrs" ADD CONSTRAINT "dcrs_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "sales_actuals" ADD CONSTRAINT "sales_actuals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "sales_actuals" ADD CONSTRAINT "sales_actuals_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "sales_actuals" ADD CONSTRAINT "sales_actuals_stockist_id_stockists_id_fk" FOREIGN KEY ("stockist_id") REFERENCES "public"."stockists"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "sales_actuals" ADD CONSTRAINT "sales_actuals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "tour_plan_visits" ADD CONSTRAINT "tour_plan_visits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "tour_plan_visits" ADD CONSTRAINT "tour_plan_visits_tour_plan_id_tour_plans_id_fk" FOREIGN KEY ("tour_plan_id") REFERENCES "public"."tour_plans"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "tour_plans" ADD CONSTRAINT "tour_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "tour_plans" ADD CONSTRAINT "tour_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "tour_plans" ADD CONSTRAINT "tour_plans_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "dcr_call_products_call_idx" ON "dcr_call_products" USING btree ("company_id","call_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "dcr_calls_user_date_idx" ON "dcr_calls" USING btree ("company_id","user_id","date");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "dcr_calls_outlet_idx" ON "dcr_calls" USING btree ("company_id","outlet_kind","outlet_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "dcrs_user_date_uq" ON "dcrs" USING btree ("company_id","user_id","date");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "sales_actuals_terr_month_idx" ON "sales_actuals" USING btree ("company_id","territory_id","month","kind");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "sales_targets_uq" ON "sales_targets" USING btree ("company_id","territory_id","month","kind",coalesce("product_id", '00000000-0000-0000-0000-000000000000'::uuid));$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX "tour_plan_visits_plan_date_idx" ON "tour_plan_visits" USING btree ("company_id","tour_plan_id","date");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX "tour_plans_user_month_uq" ON "tour_plans" USING btree ("company_id","user_id","month");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tour_plans','tour_plan_visits','dcrs','dcr_calls','dcr_call_products','sales_targets','sales_actuals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_row_meta()', t || '_row_meta', t);
  END LOOP;
END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON tour_plans, tour_plan_visits, dcrs, dcr_calls, dcr_call_products, sales_targets, sales_actuals TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON tour_plans, tour_plan_visits, dcrs, dcr_calls, dcr_call_products, sales_targets, sales_actuals FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON tour_plans, tour_plan_visits, dcrs, dcr_calls, dcr_call_products, sales_targets, sales_actuals FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0008_field_activity_sales');
END
$ariforce_migration$;
COMMIT;
