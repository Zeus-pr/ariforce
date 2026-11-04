ALTER TABLE "companies" ADD COLUMN "presentation_geofence_m" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "geo_lock_max_accuracy_m" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
CREATE TYPE "public"."geo_lock_action" AS ENUM('lock', 'edit', 'deactivate', 'reactivate');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outlet_locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"outlet_kind" "outlet_kind" NOT NULL,
	"outlet_id" uuid NOT NULL,
	"label" text NOT NULL,
	"location" geometry(Point, 4326) NOT NULL,
	"accuracy_m" real,
	"source" "geo_source" DEFAULT 'gps' NOT NULL,
	"is_mock" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "outlet_locations_label_ck" CHECK (("outlet_locations"."outlet_kind" = 'doctor' and "outlet_locations"."label" in ('clinic','hospital','chamber','residence','nursing_home','other'))
       or ("outlet_locations"."outlet_kind" = 'chemist' and "outlet_locations"."label" in ('retail_shop','distributor_counter','other'))
       or ("outlet_locations"."outlet_kind" = 'stockist' and "outlet_locations"."label" in ('godown','depot','office','other')))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_lock_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"outlet_kind" "outlet_kind" NOT NULL,
	"outlet_id" uuid NOT NULL,
	"location_id" uuid,
	"action" "geo_lock_action" NOT NULL,
	"actor_id" uuid NOT NULL,
	"before" text,
	"after" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "dcr_calls" ADD COLUMN "presentation_location_id" uuid;--> statement-breakpoint
ALTER TABLE "dcr_calls" ADD COLUMN "presentation_distance_m" bigint;--> statement-breakpoint
ALTER TABLE "dcr_calls" ADD COLUMN "presentation_accuracy_m" real;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "outlet_locations" ADD CONSTRAINT "outlet_locations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "outlet_locations" ADD CONSTRAINT "outlet_locations_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "geo_lock_events" ADD CONSTRAINT "geo_lock_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "geo_lock_events" ADD CONSTRAINT "geo_lock_events_location_id_outlet_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."outlet_locations"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "geo_lock_events" ADD CONSTRAINT "geo_lock_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outlet_locations_outlet_idx" ON "outlet_locations" USING btree ("company_id","outlet_kind","outlet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outlet_locations_location_gix" ON "outlet_locations" USING gist ("location");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outlet_locations_chem_stock_active_uq" ON "outlet_locations" USING btree ("company_id","outlet_kind","outlet_id") WHERE active and deleted_at is null and outlet_kind in ('chemist','stockist');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_lock_events_outlet_idx" ON "geo_lock_events" USING btree ("company_id","outlet_kind","outlet_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_lock_events_location_idx" ON "geo_lock_events" USING btree ("company_id","location_id","at");--> statement-breakpoint
ALTER TABLE outlet_locations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE outlet_locations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON outlet_locations;--> statement-breakpoint
CREATE POLICY tenant_isolation ON outlet_locations TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());--> statement-breakpoint
DROP TRIGGER IF EXISTS outlet_locations_row_meta ON outlet_locations;--> statement-breakpoint
CREATE TRIGGER outlet_locations_row_meta BEFORE UPDATE ON outlet_locations FOR EACH ROW EXECUTE FUNCTION set_row_meta();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON outlet_locations TO ariforce_app;--> statement-breakpoint
ALTER TABLE geo_lock_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE geo_lock_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON geo_lock_events;--> statement-breakpoint
CREATE POLICY tenant_isolation ON geo_lock_events TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT ON geo_lock_events TO ariforce_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON geo_lock_events FROM ariforce_app, PUBLIC;--> statement-breakpoint
DROP TRIGGER IF EXISTS geo_lock_events_no_update ON geo_lock_events;--> statement-breakpoint
CREATE TRIGGER geo_lock_events_no_update BEFORE UPDATE OR DELETE ON geo_lock_events FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();--> statement-breakpoint
INSERT INTO outlet_locations (id, company_id, outlet_kind, outlet_id, label, location, accuracy_m, source, is_mock, locked_at, locked_by, active)
SELECT gen_random_uuid(), d.company_id, 'doctor', d.id, 'clinic', d.location, NULL, 'manual', false, coalesce(d.geo_tagged_at, d.created_at), coalesce(d.geo_tagged_by, (SELECT u.id FROM users u WHERE u.company_id = d.company_id AND u.deleted_at IS NULL ORDER BY u.created_at ASC LIMIT 1)), true
FROM doctors d
WHERE d.location IS NOT NULL AND d.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM outlet_locations ol
    WHERE ol.company_id = d.company_id AND ol.outlet_kind = 'doctor' AND ol.outlet_id = d.id AND ol.deleted_at IS NULL
  )
  AND EXISTS (SELECT 1 FROM users u WHERE u.company_id = d.company_id AND u.deleted_at IS NULL);--> statement-breakpoint
INSERT INTO outlet_locations (id, company_id, outlet_kind, outlet_id, label, location, accuracy_m, source, is_mock, locked_at, locked_by, active)
SELECT gen_random_uuid(), c.company_id, 'chemist', c.id, 'retail_shop', c.location, NULL, 'manual', false, c.created_at, (SELECT u.id FROM users u WHERE u.company_id = c.company_id AND u.deleted_at IS NULL ORDER BY u.created_at ASC LIMIT 1), true
FROM chemists c
WHERE c.location IS NOT NULL AND c.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM outlet_locations ol
    WHERE ol.company_id = c.company_id AND ol.outlet_kind = 'chemist' AND ol.outlet_id = c.id AND ol.deleted_at IS NULL
  )
  AND EXISTS (SELECT 1 FROM users u WHERE u.company_id = c.company_id AND u.deleted_at IS NULL);--> statement-breakpoint
INSERT INTO outlet_locations (id, company_id, outlet_kind, outlet_id, label, location, accuracy_m, source, is_mock, locked_at, locked_by, active)
SELECT gen_random_uuid(), s.company_id, 'stockist', s.id, 'godown', s.location, NULL, 'manual', false, s.created_at, (SELECT u.id FROM users u WHERE u.company_id = s.company_id AND u.deleted_at IS NULL ORDER BY u.created_at ASC LIMIT 1), true
FROM stockists s
WHERE s.location IS NOT NULL AND s.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM outlet_locations ol
    WHERE ol.company_id = s.company_id AND ol.outlet_kind = 'stockist' AND ol.outlet_id = s.id AND ol.deleted_at IS NULL
  )
  AND EXISTS (SELECT 1 FROM users u WHERE u.company_id = s.company_id AND u.deleted_at IS NULL);
