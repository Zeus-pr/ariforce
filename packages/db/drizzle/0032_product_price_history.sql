CREATE TABLE IF NOT EXISTS "product_price_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"old_mrp" numeric(12, 2),
	"old_ptr" numeric(12, 2),
	"old_pts" numeric(12, 2),
	"new_mrp" numeric(12, 2),
	"new_ptr" numeric(12, 2),
	"new_pts" numeric(12, 2),
	"source" text NOT NULL,
	"bulk_id" uuid,
	"changed_by" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_price_history_source_ck" CHECK ("product_price_history"."source" in ('single','bulk','masters'))
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_price_history_product_idx" ON "product_price_history" USING btree ("company_id","product_id","changed_at");--> statement-breakpoint
ALTER TABLE product_price_history ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE product_price_history FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON product_price_history;--> statement-breakpoint
CREATE POLICY tenant_isolation ON product_price_history TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());--> statement-breakpoint
-- Append-only evidence: insert + read only (same trigger function as audit_log / geo_captures).
DROP TRIGGER IF EXISTS product_price_history_no_update ON product_price_history;--> statement-breakpoint
CREATE TRIGGER product_price_history_no_update BEFORE UPDATE OR DELETE ON product_price_history FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();--> statement-breakpoint
DROP TRIGGER IF EXISTS product_price_history_no_truncate ON product_price_history;--> statement-breakpoint
CREATE TRIGGER product_price_history_no_truncate BEFORE TRUNCATE ON product_price_history FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_mutation();--> statement-breakpoint
GRANT SELECT, INSERT ON product_price_history TO ariforce_app;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON product_price_history FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON product_price_history FROM authenticated;
  END IF;
END $$;
