-- #40 RCPA lines on chemist calls (docs/POB-RCPA.md). Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS "dcr_call_rcpa" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"competitor_brand" text,
	"competitor_company" text,
	"quantity" integer NOT NULL,
	"prescriptions" integer,
	"doctor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "dcr_call_rcpa_quantity_ck" CHECK ("dcr_call_rcpa"."quantity" > 0),
	CONSTRAINT "dcr_call_rcpa_rx_ck" CHECK ("dcr_call_rcpa"."prescriptions" is null or "dcr_call_rcpa"."prescriptions" >= 0),
	CONSTRAINT "dcr_call_rcpa_brand_ck" CHECK (("dcr_call_rcpa"."competitor_brand" is null or length("dcr_call_rcpa"."competitor_brand") between 1 and 100) and ("dcr_call_rcpa"."competitor_company" is null or ("dcr_call_rcpa"."competitor_brand" is not null and length("dcr_call_rcpa"."competitor_company") between 1 and 100)))
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "dcr_call_rcpa" ADD CONSTRAINT "dcr_call_rcpa_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "dcr_call_rcpa" ADD CONSTRAINT "dcr_call_rcpa_call_id_dcr_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."dcr_calls"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "dcr_call_rcpa" ADD CONSTRAINT "dcr_call_rcpa_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "dcr_call_rcpa" ADD CONSTRAINT "dcr_call_rcpa_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dcr_call_rcpa_call_idx" ON "dcr_call_rcpa" USING btree ("company_id","call_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dcr_call_rcpa_product_idx" ON "dcr_call_rcpa" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dcr_call_rcpa_doctor_idx" ON "dcr_call_rcpa" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dcr_call_rcpa_brand_idx" ON "dcr_call_rcpa" USING btree ("company_id",lower("competitor_brand"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dcr_call_rcpa_line_uq" ON "dcr_call_rcpa" USING btree ("call_id","product_id",lower(coalesce("competitor_brand", ''))) WHERE "dcr_call_rcpa"."deleted_at" is null;;--> statement-breakpoint
ALTER TABLE dcr_call_rcpa ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE dcr_call_rcpa FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON dcr_call_rcpa;--> statement-breakpoint
CREATE POLICY tenant_isolation ON dcr_call_rcpa TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());--> statement-breakpoint
DROP TRIGGER IF EXISTS dcr_call_rcpa_row_meta ON dcr_call_rcpa;--> statement-breakpoint
CREATE TRIGGER dcr_call_rcpa_row_meta BEFORE UPDATE ON dcr_call_rcpa FOR EACH ROW EXECUTE FUNCTION set_row_meta();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON dcr_call_rcpa TO ariforce_app;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON dcr_call_rcpa FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON dcr_call_rcpa FROM authenticated;
  END IF;
END $$;
