-- SFC (Standard Fare Chart): per-employee routes, replaces the TA/DA rates/places admin screens.
CREATE TABLE IF NOT EXISTS "sfc_routes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"hq_territory_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"from_place" text NOT NULL,
	"to_place" text NOT NULL,
	"one_way_km" numeric(8, 2) NOT NULL,
	"both_way_km" numeric(8, 2) NOT NULL,
	"one_way_amount" numeric(12, 2),
	"both_way_amount" numeric(12, 2),
	"actual_fare" boolean DEFAULT false NOT NULL,
	"travel_mode" text,
	"category" text,
	"da" numeric(12, 2),
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sfc_routes_mode_ck" CHECK ("sfc_routes"."travel_mode" is null or "sfc_routes"."travel_mode" in ('bike','bus','train','bus_train','car','other')),
	CONSTRAINT "sfc_routes_km_ck" CHECK ("sfc_routes"."one_way_km" >= 0 and "sfc_routes"."one_way_km" <= 2500),
	CONSTRAINT "sfc_routes_place_ck" CHECK (length("sfc_routes"."from_place") between 1 and 120 and length("sfc_routes"."to_place") between 1 and 120),
	CONSTRAINT "sfc_routes_category_ck" CHECK ("sfc_routes"."category" is null or length("sfc_routes"."category") <= 40),
	CONSTRAINT "sfc_routes_da_ck" CHECK ("sfc_routes"."da" is null or "sfc_routes"."da" >= 0),
	CONSTRAINT "sfc_routes_fare_ck" CHECK (("sfc_routes"."actual_fare" and "sfc_routes"."one_way_amount" is null and "sfc_routes"."both_way_amount" is null) or (not "sfc_routes"."actual_fare" and "sfc_routes"."one_way_amount" is not null and "sfc_routes"."both_way_amount" is not null))
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "sfc_rate_per_km" numeric(8, 2) DEFAULT '2.95' NOT NULL;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "sfc_routes" ADD CONSTRAINT "sfc_routes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "sfc_routes" ADD CONSTRAINT "sfc_routes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "sfc_routes" ADD CONSTRAINT "sfc_routes_hq_territory_id_territories_id_fk" FOREIGN KEY ("hq_territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "sfc_routes" ADD CONSTRAINT "sfc_routes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "sfc_routes" ADD CONSTRAINT "sfc_routes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sfc_routes_user_idx" ON "sfc_routes" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sfc_routes_hq_idx" ON "sfc_routes" USING btree ("company_id","hq_territory_id");--> statement-breakpoint
ALTER TABLE sfc_routes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sfc_routes FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON sfc_routes;--> statement-breakpoint
CREATE POLICY tenant_isolation ON sfc_routes TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());--> statement-breakpoint
DROP TRIGGER IF EXISTS sfc_routes_row_meta ON sfc_routes;--> statement-breakpoint
CREATE TRIGGER sfc_routes_row_meta BEFORE UPDATE ON sfc_routes FOR EACH ROW EXECUTE FUNCTION set_row_meta();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON sfc_routes TO ariforce_app;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON sfc_routes FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON sfc_routes FROM authenticated;
  END IF;
END $$;
